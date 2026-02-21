package preview

import (
	"net"
	"os"
	"path/filepath"
	"testing"
)

func TestLoaderCacheKey_IncludesAllInputs(t *testing.T) {
	base := loaderCacheKey("source", "/sdk/path", "17.0")

	// Same inputs must produce the same key
	if got := loaderCacheKey("source", "/sdk/path", "17.0"); got != base {
		t.Errorf("same inputs produced different keys: %s vs %s", got, base)
	}

	// Changing any single input must produce a different key
	tests := []struct {
		name             string
		source, sdk, dep string
	}{
		{"different source", "source2", "/sdk/path", "17.0"},
		{"different sdk", "source", "/sdk/path2", "17.0"},
		{"different deployment target", "source", "/sdk/path", "18.0"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := loaderCacheKey(tt.source, tt.sdk, tt.dep); got == base {
				t.Errorf("expected different key for %s, got same: %s", tt.name, got)
			}
		})
	}
}

func TestLoaderCacheKey_NoDelimiterCollision(t *testing.T) {
	// Fields that share a boundary must not collide.
	// e.g. shifting content across the delimiter boundary must produce a different key.
	a := loaderCacheKey("src", "/sdk/path", "17.0")
	b := loaderCacheKey("src\x00/sdk", "path", "17.0")
	if a == b {
		t.Error("delimiter collision: different field boundaries produced the same key")
	}
}

func TestLoaderCacheKey_Format(t *testing.T) {
	key := loaderCacheKey("src", "/sdk", "17.0")
	// SHA256 hex digest is 64 characters
	if len(key) != 64 {
		t.Errorf("expected 64-char hex digest, got %d chars: %s", len(key), key)
	}
}

func TestSendReloadCommand_OK(t *testing.T) {
	dir := t.TempDir()
	sockPath := filepath.Join(dir, "test.sock")

	// Start a mock loader server
	ln, err := net.Listen("unix", sockPath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = ln.Close() }()

	var received string
	done := make(chan struct{})
	go func() {
		defer close(done)
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		buf := make([]byte, 4096)
		n, _ := conn.Read(buf)
		received = string(buf[:n])
		_, _ = conn.Write([]byte("OK\n"))
	}()

	err = sendReloadCommand(sockPath, "/tmp/thunk_0.dylib")
	if err != nil {
		t.Fatalf("sendReloadCommand returned error: %v", err)
	}

	<-done
	if received != "/tmp/thunk_0.dylib\n" {
		t.Errorf("received = %q, want %q", received, "/tmp/thunk_0.dylib\n")
	}
}

func TestSendReloadCommand_Error(t *testing.T) {
	dir := t.TempDir()
	sockPath := filepath.Join(dir, "test.sock")

	ln, err := net.Listen("unix", sockPath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = ln.Close() }()

	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		buf := make([]byte, 4096)
		_, _ = conn.Read(buf)
		_, _ = conn.Write([]byte("ERR:dlopen failed: symbol not found\n"))
	}()

	err = sendReloadCommand(sockPath, "/tmp/thunk_0.dylib")
	if err == nil {
		t.Fatal("expected error for ERR response")
	}
	if got := err.Error(); got != "loader error: dlopen failed: symbol not found" {
		t.Errorf("error = %q", got)
	}
}

func TestSendReloadCommand_NoSocket(t *testing.T) {
	dir := t.TempDir()
	sockPath := filepath.Join(dir, "nonexistent.sock")

	// Remove socket file to make sure it doesn't exist
	_ = os.Remove(sockPath)

	err := sendReloadCommand(sockPath, "/tmp/thunk_0.dylib")
	if err == nil {
		t.Fatal("expected error when socket does not exist")
	}
}
