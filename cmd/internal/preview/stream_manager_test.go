package preview

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	pb "github.com/k-kohey/axe/internal/preview/previewproto"
)

// fakeDevicePool implements DevicePoolInterface for testing.
type fakeDevicePool struct {
	mu          sync.Mutex
	nextID      int
	acquired    map[string]bool // UDID → in-use
	released    []string        // UDIDs that were released
	shutdownAll bool

	acquireErr error
	releaseErr error
}

func newFakeDevicePool() *fakeDevicePool {
	return &fakeDevicePool{
		acquired: make(map[string]bool),
	}
}

func (p *fakeDevicePool) Acquire(_ context.Context, _, _ string) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.acquireErr != nil {
		return "", p.acquireErr
	}
	p.nextID++
	udid := fmt.Sprintf("FAKE-%d", p.nextID)
	p.acquired[udid] = true
	return udid, nil
}

func (p *fakeDevicePool) Release(_ context.Context, udid string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.releaseErr != nil {
		return p.releaseErr
	}
	delete(p.acquired, udid)
	p.released = append(p.released, udid)
	return nil
}

func (p *fakeDevicePool) ShutdownAll(_ context.Context) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.shutdownAll = true
}

func (p *fakeDevicePool) CleanupOrphans(_ context.Context) error {
	return nil
}

func (p *fakeDevicePool) GarbageCollect(_ context.Context) {}

// parsedEvent is a loosely-typed event representation for test assertions.
// We parse the JSON Lines output generically because the EventWriter now uses protojson,
// which differs from encoding/json in zero-value omission.
type parsedEvent struct {
	StreamID      string
	Frame         map[string]any
	StreamStarted map[string]any
	StreamStopped map[string]any
	StreamStatus  map[string]any
}

// collectEvents parses all JSON Lines from a buffer into parsedEvents.
func collectEvents(t *testing.T, buf *bytes.Buffer) []parsedEvent {
	t.Helper()
	var events []parsedEvent
	scanner := bufio.NewScanner(buf)
	for scanner.Scan() {
		var raw map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &raw); err != nil {
			t.Errorf("invalid JSON line: %s", scanner.Text())
			continue
		}
		e := parsedEvent{StreamID: fmt.Sprint(raw["streamId"])}
		if v, ok := raw["frame"].(map[string]any); ok {
			e.Frame = v
		}
		if v, ok := raw["streamStarted"].(map[string]any); ok {
			e.StreamStarted = v
		}
		if v, ok := raw["streamStopped"].(map[string]any); ok {
			e.StreamStopped = v
		}
		if v, ok := raw["streamStatus"].(map[string]any); ok {
			e.StreamStatus = v
		}
		events = append(events, e)
	}
	return events
}

// filterEvents returns events matching the given streamID.
func filterEvents(events []parsedEvent, streamID string) []parsedEvent {
	var filtered []parsedEvent
	for _, e := range events {
		if e.StreamID == streamID {
			filtered = append(filtered, e)
		}
	}
	return filtered
}

func TestStreamManager_AddStream_Events(t *testing.T) {
	pool := newFakeDevicePool()
	var buf bytes.Buffer
	ew := NewEventWriter(&buf)

	sm := NewStreamManager(pool, ew)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sm.HandleCommand(ctx, &pb.Command{
		StreamId: "stream-a",
		Payload:  &pb.Command_AddStream{AddStream: &pb.AddStream{File: "/path/to/HogeView.swift", DeviceType: "iPhone-16-Pro", Runtime: "iOS-18-2"}},
	})

	// Wait for stream goroutine to emit events.
	waitForEvents(t, &buf, 1, 2*time.Second)

	sm.StopAll()

	events := filterEvents(collectEvents(t, &buf), "stream-a")
	if len(events) == 0 {
		t.Fatal("expected events for stream-a, got none")
	}

	// First event should be a StreamStatus.
	first := events[0]
	if first.StreamStatus == nil {
		t.Errorf("expected StreamStatus as first event, got %+v", first)
	}
}

func TestStreamManager_RemoveStream(t *testing.T) {
	pool := newFakeDevicePool()
	var buf bytes.Buffer
	ew := NewEventWriter(&buf)

	sm := NewStreamManager(pool, ew)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sm.HandleCommand(ctx, &pb.Command{
		StreamId: "stream-a",
		Payload:  &pb.Command_AddStream{AddStream: &pb.AddStream{File: "/path/to/HogeView.swift", DeviceType: "iPhone-16-Pro", Runtime: "iOS-18-2"}},
	})

	// Wait for stream to start.
	waitForEvents(t, &buf, 1, 2*time.Second)

	sm.HandleCommand(ctx, &pb.Command{
		StreamId: "stream-a",
		Payload:  &pb.Command_RemoveStream{RemoveStream: &pb.RemoveStream{}},
	})

	// Wait for StreamStopped event.
	waitForEvents(t, &buf, 2, 2*time.Second)

	sm.StopAll()

	events := filterEvents(collectEvents(t, &buf), "stream-a")
	// Should have a StreamStopped with reason "removed".
	var foundStopped bool
	for _, e := range events {
		if e.StreamStopped != nil {
			if reason, ok := e.StreamStopped["reason"].(string); ok && reason == "removed" {
				foundStopped = true
				break
			}
		}
	}
	if !foundStopped {
		t.Errorf("expected StreamStopped{reason:removed}, events: %+v", events)
	}

	// Pool.Release should have been called.
	pool.mu.Lock()
	defer pool.mu.Unlock()
	if len(pool.released) == 0 {
		t.Error("expected pool.Release to be called")
	}
}

func TestStreamManager_NonexistentRemove(t *testing.T) {
	pool := newFakeDevicePool()
	var buf bytes.Buffer
	ew := NewEventWriter(&buf)

	sm := NewStreamManager(pool, ew)

	ctx := context.Background()

	// Should not panic.
	sm.HandleCommand(ctx, &pb.Command{
		StreamId: "nonexistent",
		Payload:  &pb.Command_RemoveStream{RemoveStream: &pb.RemoveStream{}},
	})

	sm.StopAll()
}

func TestStreamManager_TwoStreams(t *testing.T) {
	pool := newFakeDevicePool()
	var buf bytes.Buffer
	ew := NewEventWriter(&buf)

	sm := NewStreamManager(pool, ew)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sm.HandleCommand(ctx, &pb.Command{
		StreamId: "stream-a",
		Payload:  &pb.Command_AddStream{AddStream: &pb.AddStream{File: "/path/to/HogeView.swift", DeviceType: "iPhone-16-Pro", Runtime: "iOS-18-2"}},
	})
	sm.HandleCommand(ctx, &pb.Command{
		StreamId: "stream-b",
		Payload:  &pb.Command_AddStream{AddStream: &pb.AddStream{File: "/path/to/FugaView.swift", DeviceType: "iPad-Air", Runtime: "iOS-18-2"}},
	})

	// Wait for both streams to emit events.
	waitForEvents(t, &buf, 2, 2*time.Second)

	sm.StopAll()

	events := collectEvents(t, &buf)
	eventsA := filterEvents(events, "stream-a")
	eventsB := filterEvents(events, "stream-b")

	if len(eventsA) == 0 {
		t.Error("expected events for stream-a, got none")
	}
	if len(eventsB) == 0 {
		t.Error("expected events for stream-b, got none")
	}
}

func TestStreamManager_StopAll_ShutdownsPool(t *testing.T) {
	pool := newFakeDevicePool()
	var buf bytes.Buffer
	ew := NewEventWriter(&buf)

	sm := NewStreamManager(pool, ew)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sm.HandleCommand(ctx, &pb.Command{
		StreamId: "stream-a",
		Payload:  &pb.Command_AddStream{AddStream: &pb.AddStream{File: "/path/to/HogeView.swift", DeviceType: "iPhone-16-Pro", Runtime: "iOS-18-2"}},
	})

	waitForEvents(t, &buf, 1, 2*time.Second)

	sm.StopAll()

	pool.mu.Lock()
	defer pool.mu.Unlock()
	if !pool.shutdownAll {
		t.Error("expected pool.ShutdownAll to be called")
	}
}

func TestStreamManager_AcquireError(t *testing.T) {
	pool := newFakeDevicePool()
	pool.acquireErr = fmt.Errorf("no devices available")
	var buf bytes.Buffer
	ew := NewEventWriter(&buf)

	sm := NewStreamManager(pool, ew)
	defer sm.StopAll()

	ctx := context.Background()
	sm.HandleCommand(ctx, &pb.Command{
		StreamId: "stream-a",
		Payload:  &pb.Command_AddStream{AddStream: &pb.AddStream{File: "/path/to/HogeView.swift", DeviceType: "iPhone-16-Pro", Runtime: "iOS-18-2"}},
	})

	// Wait for StreamStopped event.
	waitForEvents(t, &buf, 1, 2*time.Second)

	events := filterEvents(collectEvents(t, &buf), "stream-a")
	var foundStopped bool
	for _, e := range events {
		if e.StreamStopped != nil {
			if reason, ok := e.StreamStopped["reason"].(string); ok && reason == "resource_error" {
				foundStopped = true
				break
			}
		}
	}
	if !foundStopped {
		t.Errorf("expected StreamStopped{reason:resource_error}, events: %+v", events)
	}
}

func TestStreamManager_DuplicateStreamID(t *testing.T) {
	pool := newFakeDevicePool()
	var buf bytes.Buffer
	ew := NewEventWriter(&buf)

	sm := NewStreamManager(pool, ew)
	defer sm.StopAll()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sm.HandleCommand(ctx, &pb.Command{
		StreamId: "stream-a",
		Payload:  &pb.Command_AddStream{AddStream: &pb.AddStream{File: "/path/to/HogeView.swift", DeviceType: "iPhone-16-Pro", Runtime: "iOS-18-2"}},
	})

	waitForEvents(t, &buf, 1, 2*time.Second)

	// Second AddStream with same ID should be rejected (warning log, no crash).
	sm.HandleCommand(ctx, &pb.Command{
		StreamId: "stream-a",
		Payload:  &pb.Command_AddStream{AddStream: &pb.AddStream{File: "/path/to/FugaView.swift", DeviceType: "iPad-Air", Runtime: "iOS-18-2"}},
	})

	// Should not panic — that's the test.
}

func TestStreamManager_EmptyCommand(t *testing.T) {
	pool := newFakeDevicePool()
	var buf bytes.Buffer
	ew := NewEventWriter(&buf)

	sm := NewStreamManager(pool, ew)
	defer sm.StopAll()

	// Command with no payload should not panic.
	sm.HandleCommand(context.Background(), &pb.Command{StreamId: "x"})
}

// waitForEvents polls until the buffer contains at least n newlines (events).
func waitForEvents(t *testing.T, buf *bytes.Buffer, n int, timeout time.Duration) {
	t.Helper()
	deadline := time.After(timeout)
	for {
		lines := bytes.Count(buf.Bytes(), []byte("\n"))
		if lines >= n {
			return
		}
		select {
		case <-deadline:
			t.Fatalf("timed out waiting for %d events (got %d)", n, lines)
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
}
