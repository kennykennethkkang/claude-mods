export type Event =
  | { type: "created"; id: string; title: string; at: number }
  | { type: "completed"; id: string; at: number }
  | { type: "reopened"; id: string; at: number }
  | { type: "deleted"; id: string; at: number };
