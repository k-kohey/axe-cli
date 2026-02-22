package preview

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"

	pb "github.com/k-kohey/axe/internal/preview/previewproto"
)

func TestReadCommands_ValidCommands(t *testing.T) {
	input := `{"streamId":"a","addStream":{"file":"HogeView.swift","deviceType":"iPhone16,1","runtime":"iOS-18-0"}}
{"streamId":"b","removeStream":{}}
`
	var received []*pb.Command
	readCommands(context.Background(), strings.NewReader(input), func(cmd *pb.Command) {
		received = append(received, cmd)
	})

	if len(received) != 2 {
		t.Fatalf("expected 2 commands, got %d", len(received))
	}
	if received[0].GetStreamId() != "a" || received[0].GetAddStream() == nil {
		t.Errorf("first command: got streamId=%s, addStream=%v", received[0].GetStreamId(), received[0].GetAddStream())
	}
	if received[1].GetStreamId() != "b" || received[1].GetRemoveStream() == nil {
		t.Errorf("second command: got streamId=%s, removeStream=%v", received[1].GetStreamId(), received[1].GetRemoveStream())
	}
}

func TestReadCommands_SkipsEmptyLines(t *testing.T) {
	input := `
{"streamId":"a","nextPreview":{}}

`
	var received []*pb.Command
	readCommands(context.Background(), strings.NewReader(input), func(cmd *pb.Command) {
		received = append(received, cmd)
	})

	if len(received) != 1 {
		t.Fatalf("expected 1 command (empty lines skipped), got %d", len(received))
	}
}

func TestReadCommands_SkipsInvalidJSON(t *testing.T) {
	input := `not valid json
{"streamId":"a","nextPreview":{}}
{bad json}
`
	var received []*pb.Command
	readCommands(context.Background(), strings.NewReader(input), func(cmd *pb.Command) {
		received = append(received, cmd)
	})

	if len(received) != 1 {
		t.Fatalf("expected 1 valid command, got %d", len(received))
	}
	if received[0].GetStreamId() != "a" {
		t.Errorf("expected streamId 'a', got %s", received[0].GetStreamId())
	}
}

func TestReadCommands_RespectsContextCancellation(t *testing.T) {
	pr, pw := io.Pipe()
	defer func() { _ = pw.Close() }()
	defer func() { _ = pr.Close() }()

	ctx, cancel := context.WithCancel(context.Background())
	var received []*pb.Command
	done := make(chan struct{})

	// Start the reader goroutine first.
	go func() {
		defer close(done)
		readCommands(ctx, pr, func(cmd *pb.Command) {
			received = append(received, cmd)
		})
	}()

	// Write one command.
	_, _ = pw.Write([]byte(`{"streamId":"a","nextPreview":{}}` + "\n"))

	// Wait a bit for the command to be processed, then cancel.
	time.Sleep(50 * time.Millisecond)
	cancel()

	// Close the pipe to unblock the scanner.
	_ = pw.Close()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("readCommands did not return after context cancellation")
	}

	if len(received) != 1 {
		t.Fatalf("expected 1 command before cancellation, got %d", len(received))
	}
}
