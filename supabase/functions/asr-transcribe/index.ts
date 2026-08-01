// asr-transcribe — authenticated binary audio → cloud ASR text.
// Audio and transcripts are never logged or persisted by this function.
import { createAsrHandler } from "./handler.ts";

Deno.serve(createAsrHandler());
