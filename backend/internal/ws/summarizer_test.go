package ws

import "testing"

func TestParseVocabItems(t *testing.T) {
	t.Run("array wrapped in prose", func(t *testing.T) {
		raw := "Voici : [{\"term\":\"chat\",\"translation\":\"cat\"},{\"term\":\"maison\",\"translation\":\"house\"}] fin"
		items := parseVocabItems(raw, 8)
		if len(items) != 2 || items[0].Term != "chat" || items[1].Translation != "house" {
			t.Fatalf("got %+v", items)
		}
	})
	t.Run("capped to max", func(t *testing.T) {
		raw := `[{"term":"a","translation":"1"},{"term":"b","translation":"2"},{"term":"c","translation":"3"}]`
		items := parseVocabItems(raw, 2)
		if len(items) != 2 {
			t.Fatalf("expected cap at 2, got %d", len(items))
		}
	})
	t.Run("garbage returns nil", func(t *testing.T) {
		if items := parseVocabItems("désolé, aucun mot", 8); items != nil {
			t.Fatalf("expected nil, got %+v", items)
		}
	})
	t.Run("empty array", func(t *testing.T) {
		if items := parseVocabItems("[]", 8); len(items) != 0 {
			t.Fatalf("expected empty, got %+v", items)
		}
	})
}
