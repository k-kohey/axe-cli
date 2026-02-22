package preview

import (
	"google.golang.org/protobuf/encoding/protojson"

	pb "github.com/k-kohey/axe/internal/preview/previewproto"
)

var (
	jsonMarshalOpts   = protojson.MarshalOptions{}
	jsonUnmarshalOpts = protojson.UnmarshalOptions{DiscardUnknown: true}
)

// MarshalEvent serializes a protobuf Event to JSON using protojson.
func MarshalEvent(e *pb.Event) ([]byte, error) {
	return jsonMarshalOpts.Marshal(e)
}

// UnmarshalCommand deserializes a JSON command into a protobuf Command.
func UnmarshalCommand(data []byte) (*pb.Command, error) {
	cmd := &pb.Command{}
	if err := jsonUnmarshalOpts.Unmarshal(data, cmd); err != nil {
		return nil, err
	}
	return cmd, nil
}
