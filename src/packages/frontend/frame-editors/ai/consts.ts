// Number of characters we send to AI tools for context.
export const CUTOFF = 5000;

// this came from ./create-chat, but for all frame types
export const AI_ASSIST_TAG = "code-editor";

// Max number of characters of document context included in agent assistant
// prompts. Agents have full project access, so beyond this we point them at
// the file/line range instead of pasting more.
export const AGENT_CONTEXT_CUTOFF = 12_000;
