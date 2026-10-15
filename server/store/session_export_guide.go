package store

// ExportFormatGuide travels with every download. Understanding a recording
// must not require a separate Markdown file, the TraceUX database, or an MCP.
type ExportFormatGuide struct {
	Purpose            string            `json:"purpose"`
	Collections        map[string]string `json:"collections"`
	TimeUnits          map[string]string `json:"time_units"`
	EventTypes         map[int]string    `json:"event_types"`
	NodeTypes          map[int]string    `json:"node_types"`
	IncrementalSources map[int]string    `json:"incremental_sources"`
	MouseInteractions  map[int]string    `json:"mouse_interactions"`
	PointerTypes       map[int]string    `json:"pointer_types"`
	Interpretation     map[string]string `json:"interpretation"`
	AnalysisSteps      []string          `json:"analysis_steps"`
	Rendering          string            `json:"rendering"`
	Limitations        []string          `json:"limitations"`
}

func sessionExportGuide() ExportFormatGuide {
	return ExportFormatGuide{
		Purpose: "Technical evidence of one recorded browser visit, for reconstructing what was displayed and clicked and investigating bugs. The events array is the actual rrweb replay stream, not generated reproduction instructions.",
		Collections: map[string]string{
			"session":       "Session/site/visitor identifiers, URLs, device, browser, OS, viewport, start time and duration. active means seen within 30 minutes of the snapshot; counters are stored metadata, while events.length is the actual exported replay event count.",
			"site":          "Recorded site's id, name and url. Server credentials and site keys are excluded.",
			"events":        "Complete stored rrweb events in recording chunk order, preserving order within chunks. Process this array in order; sorting/filtering can break DOM reconstruction. Stored stylesheet references are expanded into _cssText.",
			"pages":         "Page visits ordered by idx: url, title, entered_at and left_at. left_at=0 means an open last page.",
			"custom_events": "Application-provided actions ordered by ts: name, track_id and optional details. These complement the raw replay and are not required for capturing ordinary clicks or DOM changes.",
			"logs":          "Session-linked browser logs, ordered by timestamp_ms then id, with severity, message, url and any stored extra context. extra may be a string containing JSON.",
			"tickets":       "Related conversations ordered by creation time/id; each entry contains ticket metadata and messages ordered by creation time/id.",
			"feedback":      "Related ratings, comments, answers and campaign context, ordered by creation time/id.",
		},
		TimeUnits: map[string]string{
			"exported_at":                          "UTC RFC 3339 timestamp",
			"session.started_at,session.last_seen": "Unix seconds",
			"pages.entered_at,pages.left_at":       "Unix seconds",
			"events[].timestamp":                   "Unix milliseconds, visitor clock",
			"custom_events[].ts":                   "Unix milliseconds, visitor clock",
			"logs[].timestamp_ms":                  "Unix milliseconds, visitor clock",
			"created_at,updated_at,last_message_at,archived_at,session_started_at": "Unix seconds; server-created timestamps can differ from the visitor clock",
			"session.duration_ms": "Duration in milliseconds",
			"relative_replay_ms":  "Subtract events[0].timestamp from an event timestamp, custom-event ts or log timestamp_ms; unavailable when events is empty",
		},
		EventTypes: map[int]string{
			0: "DOMContentLoaded", 1: "Load", 2: "FullSnapshot", 3: "IncrementalSnapshot", 4: "Meta", 5: "Custom", 6: "Plugin",
		},
		NodeTypes: map[int]string{
			0: "Document", 1: "DocumentType", 2: "Element", 3: "Text", 4: "CDATA", 5: "Comment",
		},
		IncrementalSources: map[int]string{
			0: "Mutation", 1: "MouseMove", 2: "MouseInteraction", 3: "Scroll", 4: "ViewportResize", 5: "Input", 6: "TouchMove", 7: "MediaInteraction", 8: "StyleSheetRule", 9: "CanvasMutation", 10: "Font", 11: "Log", 12: "Drag", 13: "StyleDeclaration", 14: "Selection", 15: "AdoptedStyleSheet", 16: "CustomElement",
		},
		MouseInteractions: map[int]string{
			0: "MouseUp", 1: "MouseDown", 2: "Click", 3: "ContextMenu", 4: "DblClick", 5: "Focus", 6: "Blur", 7: "TouchStart", 8: "TouchMove_Departed", 9: "TouchEnd", 10: "TouchCancel",
		},
		PointerTypes: map[int]string{0: "Mouse", 1: "Pen", 2: "Touch"},
		Interpretation: map[string]string{
			"type_codes": "events[].type uses event_types. For type=3 only, data.source uses incremental_sources. For source=2 only, data.type uses mouse_interactions. A serialized DOM node's type uses node_types. These numeric namespaces are distinct.",
			"meta":       "A Meta event gives data.href, data.width and data.height for the URL and viewport.",
			"snapshots":  "A FullSnapshot provides data.node (serialized DOM) and data.initialOffset. Build a numeric node-id map recursively from childNodes; a later FullSnapshot replaces this DOM state.",
			"node_ids":   "An interaction data.id identifies a serialized node's numeric id, not its HTML attributes.id. Resolve the current node and ancestors to find tagName, attributes, accessible labels and child text at the interaction time.",
			"mutations":  "For source=0, adds insert node under parentId before nextId (null means append); process all adds including separately serialized descendants. removes detach a node/subtree by parentId/id. texts update textContent by id; attributes patch attributes by id (null removes the attribute). Preserve other DOM state.",
			"modals":     "Opening/closing dialogs or menus may add/remove DOM nodes or change open, hidden, aria-expanded, class or style attributes. Reconstruct those mutations and CSS before deciding what was displayed. A click alone does not prove that a modal opened or an operation succeeded.",
			"clicks":     "A type=3, source=2, data.type=2 event is a click. data.id is the target node; x/y, when present, are pointer coordinates in viewport pixels. pointerType uses pointer_types. Focus/blur events may omit coordinates.",
			"movement":   "For source=1,6,12, positions contains id/x/y/timeOffset samples. Each sample's time is the event timestamp plus timeOffset milliseconds.",
			"scroll":     "For source=3, data.id identifies the scroll target and x/y are its scroll offsets. These are not click coordinates.",
			"viewport":   "For source=4, apply data.width and data.height. Viewport, screen dimensions and coordinates are in pixels.",
			"inputs":     "For source=5, apply text and isChecked to node data.id; captured text may be masked. Do not infer original masked values.",
		},
		AnalysisSteps: []string{
			"Read session/site metadata and pages first, then custom_events, logs, tickets and feedback to locate the relevant time range.",
			"For a long recording, inspect the JSON with file/query tools rather than assuming the entire events array fits in model context. Keep the preceding FullSnapshot and intervening mutations for the time range being investigated.",
			"Reconstruct the DOM from snapshots and mutations in array order, applying CSS, viewport changes, scrolling and input updates before resolving clicks and visibility.",
			"Describe the observed sequence with relative timestamps, page URLs, element labels/attributes and numeric node IDs. Correlate browser logs using timestamp_ms and their severity/message.",
			"Produce concrete reproduction steps and separate observed behavior, expected behavior supplied by the user, hypotheses and missing evidence. Do not invent an error or assume a click succeeded.",
		},
		Rendering: "For visual playback, pass events to an rrweb-compatible browser replayer (for example rrweb Replayer or rrweb-player). This is the same recording stream used by TraceUX playback, with stored CSS expanded. A text-only AI can inspect the DOM/timeline but needs a browser/replayer to render pixels. TraceUX installation, database access and an MCP are not required to interpret the file.",
		Limitations: []string{
			"Inputs/text may be masked and blocked elements omitted according to recording settings. Unrecorded data cannot be recovered.",
			"Images, fonts and styles not captured inline retain their recorded URLs; visual fidelity requires those resources to remain accessible. Pixel screenshots are not included.",
			"The recording reconstructs captured UI state, not a running copy of the original application. Application source, backend state, API responses and network conditions are not guaranteed to be captured.",
			"An active session is a snapshot of committed data at export start. Browser-buffered events and later writes require a new export. Server and visitor clocks may differ.",
			"If no usable FullSnapshot exists, do not claim the visible DOM can be reconstructed. Preserve unknown event types/sources rather than guessing their meaning.",
		},
	}
}
