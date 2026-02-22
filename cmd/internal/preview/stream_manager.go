package preview

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	pb "github.com/k-kohey/axe/internal/preview/previewproto"
)

// DevicePoolInterface abstracts DevicePool for testability.
type DevicePoolInterface interface {
	Acquire(ctx context.Context, deviceType, runtime string) (string, error)
	Release(ctx context.Context, udid string) error
	ShutdownAll(ctx context.Context)
	CleanupOrphans(ctx context.Context) error
	GarbageCollect(ctx context.Context)
}

// stream represents a single preview stream's state.
type stream struct {
	id         string
	file       string
	deviceType string
	runtime    string
	deviceUDID string
	cancel     context.CancelFunc
	done       chan struct{} // closed when stream goroutine exits
}

// StreamManager manages multiple preview streams.
// It routes commands to the appropriate stream and coordinates shared resources.
type StreamManager struct {
	mu      sync.Mutex
	streams map[string]*stream
	pool    DevicePoolInterface
	ew      *EventWriter

	// StreamLauncher is called per-stream in a goroutine.
	// It should block until the stream ends (context cancelled or error).
	// The default implementation performs the full preview lifecycle
	// (boot, build, install, launch, watch). Tests override this with a fake.
	StreamLauncher func(ctx context.Context, sm *StreamManager, s *stream)
}

// NewStreamManager creates a StreamManager with the default stream launcher.
func NewStreamManager(pool DevicePoolInterface, ew *EventWriter) *StreamManager {
	sm := &StreamManager{
		streams: make(map[string]*stream),
		pool:    pool,
		ew:      ew,
	}
	sm.StreamLauncher = sm.defaultStreamLauncher
	return sm
}

// HandleCommand dispatches a Command to the appropriate stream.
func (sm *StreamManager) HandleCommand(ctx context.Context, cmd *pb.Command) {
	switch {
	case cmd.GetAddStream() != nil:
		sm.handleAddStream(ctx, cmd.GetStreamId(), cmd.GetAddStream())
	case cmd.GetRemoveStream() != nil:
		sm.handleRemoveStream(ctx, cmd.GetStreamId())
	case cmd.GetSwitchFile() != nil:
		sm.handleSwitchFile(cmd.GetStreamId(), cmd.GetSwitchFile())
	case cmd.GetNextPreview() != nil:
		sm.handleNextPreview(cmd.GetStreamId())
	case cmd.GetInput() != nil:
		sm.handleInput(cmd.GetStreamId(), cmd.GetInput())
	default:
		slog.Warn("Command has no payload", "streamId", cmd.GetStreamId())
	}
}

func (sm *StreamManager) handleAddStream(ctx context.Context, streamID string, add *pb.AddStream) {
	sm.mu.Lock()
	if _, exists := sm.streams[streamID]; exists {
		sm.mu.Unlock()
		slog.Warn("Duplicate streamId in AddStream, ignoring", "streamId", streamID)
		return
	}

	streamCtx, cancel := context.WithCancel(ctx)
	s := &stream{
		id:         streamID,
		file:       add.GetFile(),
		deviceType: add.GetDeviceType(),
		runtime:    add.GetRuntime(),
		cancel:     cancel,
		done:       make(chan struct{}),
	}
	sm.streams[streamID] = s
	sm.mu.Unlock()

	go sm.runStream(streamCtx, s)
}

func (sm *StreamManager) handleRemoveStream(ctx context.Context, streamID string) {
	sm.mu.Lock()
	s, exists := sm.streams[streamID]
	if !exists {
		sm.mu.Unlock()
		slog.Warn("RemoveStream for unknown streamId", "streamId", streamID)
		return
	}
	delete(sm.streams, streamID)
	sm.mu.Unlock()

	// Cancel the stream goroutine and wait for it to finish.
	s.cancel()
	<-s.done

	// Release the device back to pool.
	if s.deviceUDID != "" {
		if err := sm.pool.Release(ctx, s.deviceUDID); err != nil {
			slog.Warn("Failed to release device", "streamId", streamID, "udid", s.deviceUDID, "err", err)
		}
	}

	if err := sm.ew.Send(&pb.Event{
		StreamId: streamID,
		Payload:  &pb.Event_StreamStopped{StreamStopped: &pb.StreamStopped{Reason: "removed"}},
	}); err != nil {
		slog.Warn("Failed to send StreamStopped", "streamId", streamID, "err", err)
	}
}

func (sm *StreamManager) handleSwitchFile(streamID string, sf *pb.SwitchFile) {
	// TODO(Phase 4): implement file switching per-stream
	slog.Debug("SwitchFile not yet implemented for multi-stream", "streamId", streamID, "file", sf.GetFile())
}

func (sm *StreamManager) handleNextPreview(streamID string) {
	// TODO(Phase 4): implement next preview per-stream
	slog.Debug("NextPreview not yet implemented for multi-stream", "streamId", streamID)
}

func (sm *StreamManager) handleInput(streamID string, input *pb.Input) {
	// TODO(Phase 4): route input to stream's HID handler
	slog.Debug("Input not yet implemented for multi-stream", "streamId", streamID)
}

// runStream executes the stream lifecycle in a goroutine with panic recovery.
func (sm *StreamManager) runStream(ctx context.Context, s *stream) {
	defer close(s.done)
	defer func() {
		if r := recover(); r != nil {
			slog.Error("Stream panicked", "streamId", s.id, "panic", r)
			if err := sm.ew.Send(&pb.Event{
				StreamId: s.id,
				Payload:  &pb.Event_StreamStopped{StreamStopped: &pb.StreamStopped{Reason: "internal_error", Message: fmt.Sprintf("%v", r)}},
			}); err != nil {
				slog.Warn("Failed to send StreamStopped after panic", "streamId", s.id, "err", err)
			}
		}
	}()

	sm.StreamLauncher(ctx, sm, s)
}

// defaultStreamLauncher is the production stream lifecycle.
// It acquires a device, sends status events, and blocks until cancelled.
func (sm *StreamManager) defaultStreamLauncher(ctx context.Context, _ *StreamManager, s *stream) {
	sendStatus := func(phase string) {
		if err := sm.ew.Send(&pb.Event{StreamId: s.id, Payload: &pb.Event_StreamStatus{StreamStatus: &pb.StreamStatus{Phase: phase}}}); err != nil {
			slog.Warn("Failed to send StreamStatus", "streamId", s.id, "phase", phase, "err", err)
		}
	}

	sendStatus("booting")

	// Acquire a device from the pool.
	udid, err := sm.pool.Acquire(ctx, s.deviceType, s.runtime)
	if err != nil {
		if err := sm.ew.Send(&pb.Event{
			StreamId: s.id,
			Payload:  &pb.Event_StreamStopped{StreamStopped: &pb.StreamStopped{Reason: "resource_error", Message: fmt.Sprintf("acquiring device: %v", err)}},
		}); err != nil {
			slog.Warn("Failed to send StreamStopped", "streamId", s.id, "err", err)
		}
		return
	}
	s.deviceUDID = udid

	// TODO(Phase 4): Full lifecycle — boot simulator, build project,
	// install app, launch with hot-reload, relay video stream.
	// For now, just block until context is cancelled.
	sendStatus("running")

	<-ctx.Done()
}

// StopAll stops all active streams and shuts down the device pool.
func (sm *StreamManager) StopAll() {
	sm.mu.Lock()
	streams := make([]*stream, 0, len(sm.streams))
	for _, s := range sm.streams {
		streams = append(streams, s)
	}
	sm.streams = make(map[string]*stream)
	sm.mu.Unlock()

	// Cancel all stream goroutines.
	for _, s := range streams {
		s.cancel()
	}
	// Wait for all goroutines to finish.
	for _, s := range streams {
		<-s.done
	}

	sm.pool.ShutdownAll(context.Background())
}
