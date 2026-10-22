# ComfyUI's HTTP/WebSocket API for running a parameterised Workflow, and where vLLM-Omni fits

Researched 2026-10-22 for ticket `02-comfyui-api-and-vllm-omni`. Sources are the code first, then the official docs. Nothing here was run against a live Backend; every claim comes from reading the source or the docs.

**Versions read**

| Thing | Version / commit | Date |
| --- | --- | --- |
| ComfyUI (`Comfy-Org/ComfyUI`, canonical; `comfyanonymous/ComfyUI` resolves to the same HEAD) | tag **v0.42.4** = `3f438ca6`. Release tags sit off `master`. `master` HEAD is `1a82e6d0`; `server.py`, `execution.py`, `main.py`, `comfy/cli_args.py`, `comfy_execution/`, `nodes_video.py`, `nodes_audio.py` and `openapi.yaml` are byte-identical between the two | 2026-10-21 / 2026-10-22 |
| ComfyUI frontend (`Comfy-Org/ComfyUI_frontend`), the version v0.42.4 pins in `requirements.txt` | **v1.55.18** = `79a53509` | — |
| ComfyUI-VideoHelperSuite (`Kosinkadink/...`) | `4d907bee`, pyproject version 1.7.9 | 2026-09-01 |
| vLLM-Omni (`vllm-project/vllm-omni`) | `main` `6a56252e` (`v0.32.0rc1-47`). Newest tag v0.32.0rc1 (2026-10-19); newest non-rc tag v0.30.0 (2026-09-26) | 2026-10-22 |
| Official workflow templates (`Comfy-Org/workflow_templates`) | `447747bf` | 2026-10-22 |

Citations of the form `server.py:1162` mean ComfyUI v0.42.4 unless another repo is named.

---

## Summary

1. **Run a Workflow end to end.** Export the Workflow as API JSON. It is a map of node id to `{class_type, inputs, _meta}`. Write values into `inputs[<field>]`. Upload files with `POST /upload/image`, which takes any file type, video and audio included. Then `POST /prompt` with `{prompt, client_id, prompt_id?, extra_data?}`. The client may supply `prompt_id` as a canonical UUID, so the Generation id can be the prompt id. The response is `{prompt_id, number, node_errors}`. A validation failure returns 400 with `{error, node_errors}`.
2. **Follow progress.** Connect to `/ws?clientId=<same client_id>`. Events: `status`, `execution_start`, `execution_cached`, `executing`, `progress` (one sampler's steps), `progress_state` (per-node `value/max/state` for every started node), `executed` (outputs), `execution_success`, `execution_error`, `execution_interrupted`. The server computes no overall progress, so the client must combine per-node progress itself. The safe "finished, history written" signal is `executing` with `node: null`.
3. **Fetch outputs.** Read `GET /history/{id}` or `GET /api/jobs/{id}`, then download with `GET /view?filename&subfolder&type`. Output keys differ by node: images under `images`; core `SaveVideo` under **`images` plus `animated:[true]`**; VHS under **`gifs`**; audio under `audio`.
4. **Cancel.** `POST /api/jobs/{id}/cancel` works in any state. `POST /interrupt {prompt_id}` stops running work only. `POST /queue {delete:[ids]}` removes pending work only.
5. **No auth.** ComfyUI has no auth and no API-key flag. Its security policy treats anyone who can reach the URL as trusted.
6. **One prompt at a time per instance.** There is one in-memory queue per instance, shared by all clients, and it runs one prompt at a time. Several GPUs in one instance only speed up a single prompt (the MultiGPU CFG split). Running prompts in parallel takes one instance per GPU.
7. **Bypassed and muted nodes vanish from API JSON.** Bypassed (mode 4) and muted (mode 2) nodes are removed at export; bypassed ones are spliced through to their inputs. The API JSON has no `mode` field, so a client cannot un-bypass a node. Branch switching over the API means switch nodes (core `ComfySwitchNode`, which the official H3 and LTX 2.5 templates use), `partial_execution_targets`, or editing the graph.
8. **Subgraphs and repeatable inputs.** Subgraphs flatten to node ids like `"405:370"`. Repeatable "autogrow" inputs become keys like `ref_images.ref_image_0…8` and accept links only, so a variable number of references means adding loader nodes.
9. **vLLM-Omni.** It serves all three launch models with only part of each one's capabilities: LTX-2.5 T2V/I2V and text-to-audio; Wan 2.2 T2V/TI2V/I2V/S2V/VACE but not Animate; MiniMax H3 T2VA/FL2VA/Ref2VA plus editing. Its API is OpenAI-style `/v1/videos`. Its ComfyUI nodes are thin HTTP clients that poll the server, with no progress, no cancel and no API key. ComfyUI core now runs all three models natively, H3 included. vLLM-Omni wins mainly on multi-GPU latency and batching, for H3 and multi-GPU hosts.

---

## 1. API-format Workflow and overwriting Node fields

**How it's exported.**
- The UI menu path is File → **Export (API)**, which runs the command `Comfy.ExportWorkflowAPI` and saves the frontend's `graphToPrompt().output`. The current frontend no longer gates it behind a dev-mode setting; it sits in the File menu next to Export. Source: ComfyUI_frontend v1.55.18 `src/composables/useCoreCommands.ts:249-255` and `src/constants/coreMenuCommands.ts:7-14`.

**Shape of the JSON.**
- The top level is `{ "<node id>": { "inputs": {...}, "class_type": "<NodeClass>", "_meta": { "title": "..." } } }`.
- `_meta` is ignored by the backend.
- Widget values are written inline. A link is written as `["<origin node id>", <output index>]`.
- Because a 2-element array means a link, any array-valued widget is wrapped as `{"__value__": [...]}`, which the backend unwraps.
- Source: frontend `src/utils/executionUtil.ts:124-179`; backend unwrap in `execution.py:1000-1003`.

**Overwriting a Node field.**
- Set `prompt[nodeId].inputs[fieldName] = value`.
- Validation coerces types with Python's `int()`, `float()`, `str()` and `bool()`. Send real JSON booleans: the *string* `"false"` coerces to `True`.
- Validation also enforces `min`/`max`, and requires combo values to be in the option list unless the node defines its own validation. `LoadImage`, `LoadVideo` and `LoadAudio` all define their own: they skip the option list and only check that the file exists. So a file uploaded after the server started is accepted.
- Source: `execution.py:994-1093`; `nodes.py:1817-1821` (LoadImage); `comfy_extras/nodes_video.py:377-379` (LoadVideo); `comfy_extras/nodes_audio.py:432-434` (LoadAudio).

**Values that live on another node.**
- If a field is fed by a link, for example from a `PrimitiveStringMultiline` or `PrimitiveInt` node, the value lives on *that* node's `value` field, and that is where the Input must bind.
- The official H3 Ref2VA template feeds `prompt`, `width`, `height` and `length` through links like this. Source: `workflow_templates@447747bf templates/video_minimax_h3_r2v.json`, node 136.

**Seeds.**
- The "control after generate" widget (randomize/increment) is not serialised into API JSON. Over the API, the seed is whatever number the client sends. Source: frontend `src/scripts/widgets.ts:164`.
- Practical note: the studio should keep seeds below 2^53. JavaScript numbers lose integer precision above that, and some ComfyUI seed widgets allow up to 2^64−1.

**Subgraphs** (added at the coordinator's request).
- The official LTX 2.5 templates each put the whole graph in **one subgraph**: 42–88 inner nodes inside a single instance node on the root graph. Source: `workflow_templates@447747bf templates/video_ltx2_5_{t2v,i2v,flf2v,dfr_i2v}.json`.
- At API export the subgraph instance is virtual and not emitted. Each inner node is emitted under a **flattened, colon-joined id** `"<instanceId>:<innerId>"` (deeper nesting gives `a:b:c`).
- Values of promoted widgets are written into the *inner* node's `inputs`. Links that cross the subgraph boundary resolve to the real origin node.
- Source: frontend `src/lib/litegraph/src/subgraph/ExecutableNodeDTO.ts:113` (the id join), `src/utils/executionUtil.ts:90-110`, and the test assertions `output[\`${host.id}:${node.id}\`].inputs.value` in `src/lib/litegraph/src/subgraph/SubgraphWidgetPromotion.test.ts:1062,1131`.
- The backend treats ids as opaque strings. History outputs and WS events use the same colon ids. `executing` and `executed` also carry `display_node`. Source: `comfy_execution/graph.py:56-67`; `execution.py:497,580`.
- Consequence: an Input binds to a key like `"405:370"` + `"text"`. That key stays stable only while the admin doesn't restructure the Workflow.

**Dynamic inputs (V3 schema)** (added at the coordinator's request).
- *Autogrow* inputs serialise as **`<inputId>.<prefix><n>`**. For example, `MiniMaxH3ReferenceToVideo` declares `ref_images` with prefix `ref_image_`, min 0, max 9. Its API keys are `ref_images.ref_image_0` … `ref_images.ref_image_8`, and likewise `ref_videos.ref_video_0..2`, `ref_video_audios.ref_video_audio_0..2` and `ref_audios.ref_audio_0..2`.
- The template slot is forced to be a socket, so every slot takes a **link only** (an IMAGE/AUDIO from a loader node), never a filename. Slots that aren't connected are simply absent.
- To send a variable number of references, a client therefore adds one `LoadImage` node per file (new node id, `inputs.image = "<upload name>"`) and adds the key `ref_images.ref_image_<i>: ["<new id>", 0]`.
- The official H3 R2V template wires `ref_image_0` and `ref_image_1` and leaves `ref_image_2` open.
- Source: `comfy_api/latest/_io.py:1093-1228` (Autogrow, force_input at 1103-1104), `_io.py:1085-1091` (dot join); `comfy_extras/nodes_minimax_h3.py:255-283`; `tests-unit/execution_test/dynamic_inputs_test.py:23,169` (`"rows.item0"`, link values); template `video_minimax_h3_r2v.json` node 136.
- *DynamicCombo* inputs serialise as `<id>` = the chosen option key, plus nested fields named `<id>.<field>`. For example core `SaveVideo` uses `format` plus `format.codec`, and tests use `format.bit_depth`. Structural mistakes return the validation error `invalid_dynamic_input`. Source: `_io.py:1230-1257`; `execution.py:886-896`; `tests/execution/test_exr_previews.py:92`.

## 2. Uploading image, video and audio

**Endpoint.**
- There is **one upload route for every media type: `POST /upload/image`** (also mounted as `/api/upload/image`). It takes multipart form-data with these fields:
  - `image`: the file. Any type is accepted; nothing checks the MIME type.
  - `type`: `input` (default), `temp` or `output`.
  - `subfolder`: optional. Path traversal is rejected with 400.
  - `overwrite`: `"true"` or `"1"` replaces a file with the same name.
- Without `overwrite`, a same-name file with an identical hash is reused, and a different file is renamed `name (1).ext`.
- The response is `{name, subfolder, type}`. When the opt-in assets system is on, it also includes `asset`.
- The value to put in a loader's Node field is `"subfolder/name"`, or just `"name"`. An annotated form such as `"name [output]"` points a loader at the output or temp folder instead.
- Source: `server.py:435-548`; `folder_paths.py:266-279`.
- The frontend itself posts video and audio uploads to this same route. Source: frontend `src/extensions/core/uploadAudio.ts:50-58` and `src/composables/node/useNodeImageUpload.ts:25-30`.
- Loader Node fields: `LoadImage.image`, `LoadVideo.file` and `LoadAudio.audio`. `LoadAudio` lists both audio and video files. Source: `nodes.py:1747-1754`; `comfy_extras/nodes_video.py:341-356`; `comfy_extras/nodes_audio.py:398-412`.
- `/upload/mask` exists too: it merges an alpha channel into an image that is already on the server. Source: `server.py:551-595`.

**Size limit.**
- `--max-upload-size` defaults to **100 MB**. It becomes aiohttp's `client_max_size`, so it limits *every* request body, `POST /prompt` included. Video Uploads larger than that need the flag raised on the Backend.
- Source: `comfy/cli_args.py:68`; `server.py:292-293`.

**What's missing.**
- No route deletes files in `input/` or `output/`. Uploads and outputs build up on disk until something outside ComfyUI cleans them up.
- The opt-in assets system (`--enable-assets`) adds `/api/assets` with upload, list and DELETE, but it is off by default. Source: `comfy/cli_args.py:280-281,307-309`; `app/assets/api/routes.py:679,818`.

## 3. Queueing: `POST /prompt`

**Request body.** Source: `server.py:1162-1241`.

| Key | Meaning |
| --- | --- |
| `prompt` | The API-format graph (required). Missing it gives 400 `no_prompt`. |
| `client_id` | Copied into `extra_data.client_id`. It decides which WebSocket receives this prompt's events. |
| `prompt_id` | Optional. Must be a UUID in **canonical lowercase hyphenated** form, or the server returns 400 `invalid_prompt_id`. Absent or `null` means the server mints one. Source: `comfy_execution/jobs.py:34-50`. |
| `extra_data` | Free-form dict carried to execution. Keys the server knows: `extra_pnginfo` (embedded in saved files' metadata), `preview_method` (`none`, `auto`, `latent2rgb`, `taesd`), `api_key_comfy_org` / `auth_token_comfy_org` (see §10), `comfy_usage_source`. |
| `number` / `front` | Queue priority. The queue is a heap ordered by `number`; `front: true` negates the counter so the item jumps the queue. |
| `partial_execution_targets` | A list of output-node ids. **Only these outputs are validated and executed.** Source: `execution.py:1182-1184`. |
| `workflow_metadata` | A dict up to 256 bytes once serialised. It is merged into every outgoing WS message that carries `prompt_id`. Source: `server.py:82-110,1210-1215,1495-1513`. |

**Success response.**
- HTTP 200 with `{"prompt_id", "number", "node_errors"}`.
- Pitfall: if *some* output nodes fail validation but at least one passes, the response is still **200**. `node_errors` is then non-empty, and the failing outputs are silently dropped. Source: `server.py:1221-1230`; `execution.py:1231-1301`.

**Validation failure response.**
- HTTP 400 with `{"error": {type, message, details, extra_info}, "node_errors": {...}}`.
- Each entry in `node_errors` looks like `{"<node id>": {"errors": [{type, message, details, extra_info: {input_name, input_config, received_value, ...}}], "dependent_outputs": [...], "class_type": "..."}}`.
- Per-input error types: `required_input_missing`, `bad_linked_input`, `return_type_mismatch`, `invalid_input_type`, `value_smaller_than_min`, `value_bigger_than_max`, `value_not_in_list`, `custom_validation_failed`, `invalid_dynamic_input`, `dependency_cycle`, `exception_during_inner_validation`.
- Top-level error types: `prompt_outputs_failed_validation`, `prompt_no_outputs`, `exception_during_validation`.
- Source: `execution.py:849-1301`.

**Missing custom nodes.**
- A node whose `class_type` isn't installed returns 400 at the **first** such node, with error type `missing_node_type`, a message saying the custom node may not be installed, `extra_info: {node_id, class_type, node_title}`, and `node_errors: {}`.
- To list *all* missing classes, the studio must compare the Workflow's `class_type`s with the keys of `/object_info` itself.
- Core first applies registered node replacements for deprecated classes (`apply_replacements`).
- Source: `execution.py:1147-1180`; `server.py:1200`; `app/node_replace_manager.py:61`.

**Duplicate ids.**
- The server never checks whether a `prompt_id` was used before. A second run with the same id overwrites the first one's history entry. Source: `execution.py:1354-1359`.

**Cached results.**
- When the same graph runs again with identical inputs, every node is served from cache. Output nodes re-emit their *previous* file entries, and no new file is written. Source: `execution.py:447-452`; `comfy_execution/asset_enrichment.py:129-142`.

**Metadata in saved files.**
- Unless the Backend runs with `--disable-metadata`, saved images and videos embed the full API prompt plus `extra_pnginfo`. Source: `comfy_extras/nodes_video.py:185-192`; `comfy/cli_args.py:216`.

## 4. Following execution live: `/ws`

**Connecting.**
- Connect to `ws://host/ws?clientId=<id>`. Reconnecting with the same `clientId` replaces the old socket. If that client's prompt is running, the server immediately re-sends the current `executing` node.
- The first frame the client sends may be `{"type":"feature_flags","data":{...}}`. With `supports_preview_metadata`, previews switch to the binary format with metadata.
- Source: `server.py:334-392`.

**Who receives what.**
- Execution events go **only to the socket whose id equals the prompt's `client_id`**. `status` goes to everyone.
- If that socket is disconnected, its events are dropped. Nothing is buffered or replayed.
- Source: `server.py:1485-1493`; `execution.py:680-687`.

**Events, in order.** Every execution event carries `prompt_id`.

| Event | `data` | Source |
| --- | --- | --- |
| `status` | `{status:{exec_info:{queue_remaining}}, sid?}` — sent on connect and on every queue change | `server.py:352,1386-1391,1515-1516` |
| `execution_start` | `{prompt_id, timestamp}` | `execution.py:745` |
| `execution_cached` | `{nodes:[ids served from cache], prompt_id, timestamp}` | `execution.py:773-775` |
| `executing` | `{node, display_node, prompt_id}` per node. **`{node:null, prompt_id}` comes after the history entry is written.** | `execution.py:497`; `main.py:388-398` |
| `progress` | `{value, max, prompt_id, node}` — the step progress of the node currently running (samplers, or any node that reports progress) | `main.py:455-470` |
| `progress_state` | `{prompt_id, nodes:{<id>:{value, max, state:"running"\|"finished", node_id, prompt_id, display_node_id, parent_node_id, real_node_id}}}` — sent at each node start, update and finish; covers every node that is not pending | `comfy_execution/progress.py:161-186` |
| `executed` | `{node, display_node, output:{...ui outputs}, prompt_id}` — only for nodes that return UI output, cached ones included | `execution.py:566-580`; `asset_enrichment.py:138-142` |
| `execution_success` | `{prompt_id, timestamp}` — sent *before* history is written | `execution.py:827` |
| `execution_error` | `{prompt_id, node_id, node_type, executed, exception_message, exception_type, traceback, current_inputs, current_outputs, timestamp}` | `execution.py:704-715` |
| `execution_interrupted` | `{prompt_id, node_id, node_type, executed, timestamp}` | `execution.py:695-702` |

**Binary frames.**
- Each binary frame starts with a 4-byte big-endian event type: 1 is a preview image (followed by a 4-byte image type, 1 = JPEG, 2 = PNG); 3 is progress text; 4 is a preview image with a JSON metadata header.
- Previews are sent only if `--preview-method` or `extra_data.preview_method` turns them on. The default is none.
- Source: `protocol.py:1-5`; `server.py:1414-1473,1588-1598`; `comfy/cli_args.py:136`.

**Telling the outcomes apart.**
- Each outcome is unique: `execution_success`, `execution_error` or `execution_interrupted`. The same result is kept afterwards as `history[id].status = {status_str: "success"|"error", completed, messages:[[event, data], ...]}`.
- `/api/jobs/{id}` turns this into `completed`, `failed` or `cancelled` (an interrupt becomes `cancelled`).
- One edge case: a node returning an `ExecutionBlocker` with a message sends an `execution_error` event, yet the prompt carries on. The final status should therefore come from history or the terminal event, not from the first `execution_error`.
- Source: `comfy_execution/jobs.py:205-265`; `execution.py:525-540`.
- Validation errors never reach the WebSocket. They only come back in the HTTP response to `POST /prompt` (§3).

**Overall progress across several samplers.**
- The server sends no overall figure.
- The stock frontend computes `(nodes executed or cached) / (nodes in the prompt)`. Source: frontend `src/stores/executionStore.ts:426-443,510-515`.
- `progress_state` gives `value/max` for every node that has started. A client can therefore build a weighted overall figure, but only if it knows ahead of time which nodes are samplers and how many steps each will run. Those step counts are readable from the sampler nodes' `steps` fields, or from the length of a `ManualSigmas` list, in the submitted graph.
- A two-pass Workflow (for example LTX 2.5 two-stage, or Wan 2.2 high/low-noise `KSamplerAdvanced` pairs) therefore needs per-Model weights, or a sum of steps across all sampler nodes.
- `NodeState.Error` is defined but core never sets it. Source: `comfy_execution/progress.py:16-20`.

## 5. Fetching outputs

**History.**
- `GET /history/{prompt_id}` returns `{<id>: {prompt:[number, id, graph, extra_data, outputs_to_execute], outputs:{<node id>: {...}}, meta:{<node id>: {node_id, display_node, parent_node, real_node_id}}, status}}`.
- Sensitive `extra_data` keys are stripped. History lives **in memory only**: up to 10,000 entries, lost on restart.
- Source: `server.py:1135-1152`; `execution.py:829-837,1303,1340-1360`; `main.py:387`.
- `GET /api/jobs/{id}` returns the same data normalised: `status`, `outputs`, `execution_error`, timestamps and `preview_output`. `GET /api/jobs` lists jobs with filters for `status` and `workflow_id`, sorting and pagination. Source: `server.py:911-1032`; `comfy_execution/jobs.py`.

**Downloading.**
- `GET /view?filename=…&subfolder=…&type=output|input|temp` serves the file.
- Optional parameters: `preview=webp;90` or `preview=jpeg` re-encode images, and `channel=rgb|a` selects channels.
- Dangerous content types are forced to download as attachments.
- Source: `server.py:597-747`.

**Output keys in `outputs[node]` and in `executed.output`.** Every file entry is `{filename, subfolder, type}`.

| Node | Key | Source |
| --- | --- | --- |
| `SaveImage` / `PreviewImage` | `images` (`type` `output` / `temp`) | `nodes.py:1728` |
| Core `SaveVideo`, `SaveWEBM` | **`images`** + `animated: [true]` — the UI class `PreviewVideo` reuses the `images` key | `comfy_api/latest/_ui.py:426-431`; `comfy_extras/nodes_video.py:74,203` |
| `SaveAudio`, `SaveAudioMP3`, `SaveAudioOpus`, `SaveAudioAdvanced`, `PreviewAudio` | `audio` | `_ui.py:54-61,411-423`; `comfy_extras/nodes_audio.py:198-357` |
| `VHS_VideoCombine` | **`gifs`**: `[{filename, subfolder, type: "output" or "temp" (from save_output), format: MIME such as "video/h264-mp4", frame_rate, workflow: <first-frame PNG>, fullpath: <absolute path on the Backend>}]`. With audio attached it writes two files and reports the `-audio` one. During a meta-batch it reports `unfinished_batch` instead. | VHS `videohelpersuite/nodes.py:245-280,567,622-634` |
| `LoadVideo` (an intermediate-output node) | `images` + `animated`, **`type: "input"`** — a preview of the *source* clip | `comfy_extras/nodes_video.py:341-392` |
| `PreviewAny` | `text` | `_ui.py:475-480` |

- Core also adds a `metadata` object to each image and video entry, with `width`, `height`, and for video `duration`, `fps` and `frame_count`. With assets enabled it adds `id` and `preview_id` as well. Source: `comfy_execution/media_enrichment.py:52-94`; `comfy_execution/asset_enrichment.py:98-109`.
- Consequence: the studio should collect Assets by **file extension or MIME type across all keys**, and keep only `type == "output"` entries, optionally only from the output nodes the admin names. It should not rely on a `video` key, which core does not use.

## 6. Cancelling

| Call | Effect | Source |
| --- | --- | --- |
| `POST /api/jobs/{id}/cancel` | State-agnostic: interrupts the job if it is running, dequeues it if it is pending, and does nothing if it already finished or is unknown. Returns `{"cancelled": bool}`. Since v0.26.0. | `server.py:1034-1077`; commit `4e716f7c` |
| `POST /api/jobs/cancel` `{job_ids:[...]}` | The same for a batch. Returns 400 on malformed ids. | `server.py:1079-1133` |
| `POST /interrupt` `{prompt_id}` | Interrupts only if that prompt is the one running, otherwise does nothing. With no body it interrupts whatever is running. Since v0.3.57. | `server.py:1257-1287`; commit `464ba1d6` |
| `POST /queue` `{delete:[ids]}` / `{clear:true}` | Removes **pending** items only, on the local server. `openapi.yaml` marks this route deprecated and says `delete` also cancels running jobs; that describes the cloud runtime, not `server.py`. | `server.py:1243-1255`; `openapi.yaml` `/api/queue` |
| `POST /history` `{delete:[ids]}` / `{clear:true}` | Removes history entries. | `server.py:1300-1311` |

**How quickly an interrupt lands.**
- The interrupt flag is checked before each node and inside the progress hook, which samplers call every step. So it takes effect at the next step or the next node boundary.
- A long node that never reports progress, such as a VAE decode or a remote API call, finishes first.
- An interrupted prompt goes to history as an error with `execution_interrupted`. A dequeued prompt never reaches history, so `/api/jobs/{id}` returns 404 for it.
- Source: `nodes.py:50-54`; `main.py:462`; `execution.py:266-268`; `comfy_execution/jobs.py:394-418`.

## 7. Auth, `--listen`, CORS, multi-user

**Auth.**
- ComfyUI has **no authentication of any kind**: no API-key or password flag, and no auth on `/ws`. Source: `comfy/cli_args.py` (full flag list).
- The project's security policy says anyone who can reach the URL is trusted. It puts securing a `--listen` deployment (firewall, reverse proxy, auth) on whoever exposes it. Source: `SECURITY.md:5-11,26`.

**Network flags.**
- `--listen` defaults to `127.0.0.1`. Given with no value it listens on all IPv4 and IPv6 addresses. `--port` defaults to 8188. `--tls-keyfile` plus `--tls-certfile` turn on HTTPS. Source: `comfy/cli_args.py:63-66`.

**CORS.**
- `--enable-cors-header [origin]` adds `Access-Control-Allow-*` headers.
- Without it, a middleware returns 403 when `Sec-Fetch-Site: cross-site` is set, or when the Host is loopback and the Origin differs. Server-to-server calls from the studio carry neither header, so they are unaffected.
- Source: `server.py:159-241,281-284`.

**Multi-user.**
- `--multi-user` plus a `comfy-user` header selects per-user *settings and userdata* storage. It is **not** auth, and it does not separate queue, history or outputs.
- `/queue`, `/history` and `/api/jobs` show every client's prompts, including the full graph.
- Source: `app/user_manager.py:59-70`; `server.py:113-115,1154-1160`.

**Partner nodes and other hardening flags.**
- `--disable-partner-nodes` stops the paid API nodes from loading. `--offline` does that too and also locks the frontend's CSP.
- `--disable-metadata` keeps prompts out of saved files.
- Source: `comfy/cli_args.py:216-222`; `main.py:608`.

## 8. Concurrency: queue, clients, GPUs

**Queue.**
- There is **one `PromptQueue` per process**, served by **one worker thread**, so exactly one prompt executes at a time per instance. All clients share the queue.
- Queued and history items live in memory and are lost on restart.
- Source: `execution.py:1305-1333`; `main.py:336-383,625`.

**Several GPUs in one instance.**
- `--cuda-device 0,1` (or `all`) makes several GPUs visible to one instance. Core's `MultiGPU_WorkUnits` ("MultiGPU CFG Split", since v0.23.0) plus `SelectModelDevice` / `SelectCLIPDevice` / `SelectVAEDevice` spread *one* sampling run across GPUs. That is lower latency for a single prompt, not parallel prompts.
- Source: `comfy/cli_args.py:78`; `main.py:98-104`; `comfy_extras/nodes_multigpu.py:20-48,395-405`; commit `0a2dd86e`.

**Parallel prompts.**
- Running prompts in parallel takes **one ComfyUI process per GPU**, each with `--cuda-device N` and its own `--port`. Each process is a separate Backend.
- `/system_stats` reports every device with total and free VRAM, plus `comfyui_version`. That is useful for health checks.
- Source: `server.py:772-823`.

**Caching between prompts.**
- The node-output cache survives across prompts (RAM-pressure cache by default). Generations that differ only by seed reuse the loaded models and text encodings and re-run only the sampler and the nodes after it.
- Source: `main.py:336-356`; `comfy/cli_args.py:140-145`.

## 9. `/object_info` for validating Node fields

**Endpoints.**
- `GET /object_info` returns every node class, and `GET /object_info/{class}` returns one.
- Source: `server.py:841-909`; V3 nodes via `comfy_api/latest/_io.py:1748-1770,2084-2089`.

**Fields per class.**
- `input: {required|optional|hidden: {name: [type, options]}}` and `input_order`.
- `output`, `output_name` and `output_is_list`.
- `name`, `display_name`, `description` and `category`.
- **`python_module`**, which names the custom-node pack a class comes from.
- `output_node`, `deprecated`, `experimental` and `api_node`.

**How field types appear.**
- V1 combos are `[[...options], {...}]`. V3 combos are `["COMBO", {options:[...], ...}]`.
- Upload widgets carry `image_upload`, `video_upload` or `audio_upload: true`.
- Numbers carry `default`, `min`, `max` and `step`.
- Dynamic inputs appear as `COMFY_AUTOGROW_V3` (with `template:{prefix,min,max}`) or `COMFY_DYNAMICCOMBO_V3`.
- Source: `_io.py:40-44,344-390,1093-1257`.

**Practical notes.**
- Model-file combos list the files currently on the Backend, so the admin panel can check `unet_name` and similar fields against them.
- The full call is large, so the studio should fetch it once and cache it.

## 10. Bypass, mute, branches, and partner-node keys

**Bypass and mute in API export.**
- Muted (`mode` 2, NEVER) and bypassed (`mode` 4, BYPASS) nodes are **left out of the API JSON**.
- For a *bypassed* node, each consumer is rewired to the bypassed node's first input of matching type, so the data passes straight through.
- For a *muted* node, the consumer's input is deleted. That can trigger `required_input_missing`.
- The API JSON has no `mode` field.
- Source: frontend `src/utils/executionUtil.ts:100-122,183-193`; `ExecutableNodeDTO.ts:275-293,351-380`; `globalEnums.ts:83-89`.
- In the official templates, `video_wan2_2_14B_flf2v.json` ships 19 nodes at mode 4: the bypassed "lightning LoRA" copy of the graph. Source: `workflow_templates@447747bf`.

**Switching branches from a client.** These are the mechanisms that exist:
- **Switch nodes.**
  - Core `ComfySwitchNode` ("If/Else Switch", marked experimental) takes `switch: BOOLEAN` plus lazy `on_false` / `on_true`. Only the selected branch executes.
  - The official H3 R2V template drives two of them from one `PrimitiveBoolean` ("Enable Lightning LoRA"). The LTX 2.5 template subgraphs also contain `ComfySwitchNode` and `PrimitiveBoolean` nodes.
  - Source: `comfy_extras/nodes_logic.py:86-116,335-352`; templates as above.
  - **Caveat:** lazy inputs skip *execution* but not *validation*. `validate_inputs` follows every link, so nodes on the unused branch must still validate. A `LoadImage` there must point at a file that exists, and a LoRA there must be installed. Source: `execution.py:928-975`.
- **`partial_execution_targets`.** When branches end in different output nodes, listing only the wanted outputs validates and runs only those. Source: `execution.py:1182-1184`; `server.py:1196-1202`.
- **Editing the graph on the client.** Delete nodes and rewire links in the API JSON, which amounts to re-implementing bypass. Or keep the UI-format JSON, where `mode` exists, and port `graphToPrompt` to the server, including its subgraph, virtual-node and bypass resolution.
- `ExecutionBlocker` lets a custom node silently block what comes after it. Source: `comfy_execution/graph_utils.py:140-155`.

**Partner-node keys** (added at the coordinator's request).
- Partner/API nodes (`is_api_node`) receive `auth_token_comfy_org` and `api_key_comfy_org` as hidden inputs, read from **`extra_data` of `POST /prompt`**. They send the token as `Authorization: Bearer …` or the key as `X-API-KEY: …`.
- Both keys are in `SENSITIVE_EXTRA_DATA_KEYS`, so they are stripped from queue, history and job listings.
- docs.comfy.org's API-key page gives the same recipe (put `api_key_comfy_org` in `extra_data`) and notes the account needs credits.
- For a studio running only local nodes this doesn't matter. Starting Backends with `--disable-partner-nodes` makes an imported Workflow that contains paid nodes fail validation (`missing_node_type`) instead of spending money.
- The LTX 2.5 templates' `TextGenerateLTX2Prompt` is a *local* node that runs the loaded text encoder, not a partner node.
- Source: `execution.py:162,207-212,229-232,1224-1226`; `comfy_api/latest/_io.py:1737-1739,1947-1953`; `comfy_api_nodes/util/_helpers.py:195-204`; `comfy_extras/nodes_textgen.py:242-245`; https://docs.comfy.org/development/comfyui-server/api-key-integration

## 11. vLLM-Omni

**What it is.**
- vLLM-Omni is a vLLM-based server for omni-modal models (Apache-2.0).
- Each server serves **one model**, started with `vllm serve <model> --omni`. Changing the pipeline class (for example from LTX one-stage to two-stage) means restarting the server.
- Source: vllm-omni `docs/serving/videos_api.md:7-8`; `recipes/LTX/LTX-2.5.md:282-283`.

**Launch-model coverage** (supported-models table, the same at v0.30.0 and at main `6a56252e`):

| Launch model | What vLLM-Omni serves | Not served (per its docs and code) | Hardware notes from recipes |
| --- | --- | --- | --- |
| **LTX 2.5** (`Lightricks/LTX-2.5-Diffusers`, gated) | T2V and **first-frame** I2V. Full or distilled, one- or two-stage pipelines. Every video carries 48 kHz stereo audio. Also `LTX2TextToAudioPipeline` via `/v1/audio/generate`. | Last-frame or keyframe conditioning, control/IC-LoRA, V2V, extension: "I2V accepts exactly one initial image" | B300 verified. On H100 80 GB, FP8 distilled one-stage at 960×544. Two-stage 1920×1088 peaks around 114 GB. 4-GPU USP path for low latency. |
| **Wan 2.2** | T2V-A14B, TI2V-5B, I2V-A14B, S2V-14B, VACE (a community Diffusers conversion). The I2V pipeline code accepts a `last_image`. | **Animate** has no native pipeline; it appears only in the generic diffusers-adapter utils registry. | Recipes target 8× H20/H100/A100 with `usp × cfg = 8`. S2V on 2× A100/H100 80 GB. Single Intel Arc B70 32 GB with offload. |
| **MiniMax H3** (`MiniMaxAI/MiniMax-H3`) | T2VA, FL2VA (first/last keyframes), Ref2VA (≤9 images, 3 videos, 3 audios), latent-mask editing, timeline guides, latent upscale/refine, Turbo LoRA, FastH3 (some marked experimental). | Ref2VA audio-only; CFG-parallel | Each partition is about 135 GiB of weights. The 2× RTX 4090/5090 TP2 profile needs **≥200 GiB host RAM** (384 recommended). A single-GPU layerwise-offload "capacity path" exists, described as not a latency profile. 4-GPU profiles. |

Sources: `docs/models/supported_models.md:42-43,48-59,64-67`; `recipes/LTX/LTX-2.5.md:7-10,27-36,121-131,285-296`; `recipes/Wan-AI/Wan2.2-T2V.md:31-78`, `Wan2.2-S2V.md:33-57`; `vllm_omni/diffusion/models/wan2_2/pipeline_wan2_2_i2v.py:101-154`; `vllm_omni/diffusion/models/diffusers_adapter/pipeline_utils.py:119-127`; `recipes/MiniMaxAI/MiniMax-H3.md:6-24,105-168,1703-1747`; `recipes/MiniMaxAI/MiniMax-H3-4090.md:10-17,99-102`.

**HTTP API (OpenAI-compatible).**

*Video endpoints:*
- `POST /v1/videos` takes multipart form-data and returns `{id, status:"queued", created_at}`.
- `GET /v1/videos/{id}` returns `{status: queued|in_progress|completed|failed, progress 0–100, error, ...}`.
- `GET /v1/videos/{id}/content` returns the MP4.
- `DELETE /v1/videos/{id}` aborts the job with a time bound and deletes it.
- `POST /v1/videos/sync` blocks and returns the raw bytes.

*Request fields:*
- Core: `prompt`, `size` / `seconds` or `width` / `height` / `num_frames` / `fps`, `num_inference_steps`, `guidance_scale` / `guidance_scale_2`, `seed`, `negative_prompt`.
- Media: `input_reference` (an uploaded file), and `image_reference` / `video_reference` / `audio_reference` (JSON URLs or data URLs).
- Model-specific: `extra_params` (JSON), `lora` (JSON), and the H3-specific file fields.

*Other endpoints and serving options:*
- Images go through `/v1/images/...`, audio through `/v1/audio/generate` and `/v1/audio/speech`. `WS /v1/realtime/video` streams fragmented MP4 for supported models.
- `--api-key` enables `Authorization: Bearer` auth.
- Batching: `--max-num-seqs N` for request-level batching, and `--step-execution` for continuous batching.

*Gap:* in the current code the job `progress` field is only ever set to 100, at completion, so it gives no live progress.

Sources: `docs/serving/videos_api.md:43-143`; `docs/serving/README.md:40-42`; `docs/user_guide/diffusion/execution_modes.md:9-17`; `vllm_omni/entrypoints/openai/protocol/videos.py:28-32,474`; `vllm_omni/entrypoints/openai/video/generation/helpers.py:456`.

**Its ComfyUI nodes** (`apps/ComfyUI-vLLM-Omni`, installed by copying the folder into `custom_nodes`).
- Classes: `VLLMOmniGenerateVideo`, `VLLMOmniGenerateImage`, `VLLMOmniTTS`, `VLLMOmniVoiceClone`, `VLLMOmniGenerateMusic`, `VLLMOmniUnderstanding`, `VLLMOmniVideoReferences`, `VLLMOmniLatentMaskEditing`, plus parameter nodes (`VLLMOmniWanParams`, `VLLMOmniMiniMaxH3Params`, sampling, `VLLMOmniRemoteLoRA`, `VLLMOmniFastH3Deployment`).
- `GenerateVideo` has Node fields `url`, `model`, `prompt`, `negative_prompt`, `width`, `height`, `fps` and `duration` (seconds), and optional `frame` / `first_frame` / `last_frame` IMAGE inputs. First and last frames are allowed only for H3.
- At run time it POSTs `/v1/videos`, **polls every 5 s for up to 30 min**, downloads the content, decodes it to a ComfyUI `VIDEO`, and DELETEs the job.
- It sends **no Authorization header**, reports **no progress** to ComfyUI and **does not handle interrupts**. A ComfyUI cancel therefore waits until the poll ends, and the remote job keeps running.
- ComfyUI itself needs no GPU for these nodes; the docs suggest starting it with `--cpu`.
- Source: `apps/ComfyUI-vLLM-Omni/__init__.py:39-60`; `comfyui_vllm_omni/nodes.py:181-221`; `comfyui_vllm_omni/utils/api_client.py:76-87,299-308,464-498`; `docs/features/comfyui.md`.

**ComfyUI native support for the same models.**
- **LTX 2.5**: core since v0.32.0 (commit `57ce8e1a`, "Add support for LTX 2.5"), with official templates for t2v, i2v, flf2v and dfr_i2v.
- **Wan 2.2**: core model classes for T2V, S2V, Animate, Camera and WanDancer, with templates for animate, flf2v, fun control/camera/inpaint and more.
- **MiniMax H3**: core model and native nodes `EmptyMiniMaxH3LatentAV`, `MiniMaxH3ImageToVideo`, `MiniMaxH3AddGuide`, `MiniMaxH3ReferenceToVideo`, `MiniMaxH3SigmaShift` and `MiniMaxH3FunControlNetApply`, with templates for t2v, i2v, r2v, continuation, multiframe reference and controlnet union. H3 work is ongoing, for example "Reduce MiniMax-H3 peak VRAM" (2026-10-01) and LightVAE support (2026-10-15).
- Source: `comfy/supported_models.py:970,985,1436-1580`; `comfy_extras/nodes_minimax_h3.py:98-583`; `workflow_templates@447747bf templates/`.

**When vLLM-Omni beats native ComfyUI nodes.**
- *Multi-GPU latency for one request:* Ulysses/ring sequence parallelism, TP, CFG-parallel and VAE patch-parallel. ComfyUI offers only the CFG-split node.
- *Throughput:* request-level and step-level batching suit multi-generation of the same Model.
- *Capability:* H3 features exposed as API fields, such as masked editing, timeline guides and FastH3.
- *Job control:* a real job API with cancel and `--api-key` auth.

**When it loses.**
- Fewer capabilities per model: no LTX keyframes, control or extension; no Wan Animate.
- No graph composition: pre- and post-processing must happen outside it.
- Operational cost: one model per process, Diffusers-format weights downloaded separately, large host-RAM needs for H3.
- Visibility: no step-level progress over HTTP.
- *Through* ComfyUI, the nodes also lose cancel, progress and auth.

---

## Options & implications for the studio (for the decision tickets — not decided here)

1. **Where the queue lives.**
   - *Option A:* the studio's own queue (ticket 06) sends one prompt at a time to each Backend. Cancel stays simple, Backend restarts lose nothing, and the studio controls fairness and per-user caps.
   - *Option B:* the studio pushes many prompts into ComfyUI's queue. Throughput is slightly better because there is no idle gap, but the work sits in volatile memory and ComfyUI orders it only by `number`.
   - Either way, a Generation's id can be the `prompt_id`, given as a canonical UUID. The studio must never reuse one, because reuse overwrites history.
2. **How to follow progress.**
   - *Option A:* keep one long-lived WS per Backend, using the same `client_id` that queued the work. This gives live progress.
   - *Option B:* poll `/api/jobs/{id}` or `/history/{id}`. Simpler, and it survives reconnects.
   - Events are not replayed, so a WS-based design still has to reconcile through `/api/jobs/{id}` after any disconnect. The "done" trigger should be `executing{node:null}` or the job status, not `execution_success`.
3. **Overall progress.**
   - (a) Ratio of nodes done, as the stock UI does.
   - (b) Sum of sampler steps from the submitted graph, weighted with `progress_state`.
   - (c) Admin-set phase weights per Model.
   - All three are coarse for VAE decode, which sends no progress.
4. **How a Mode steers the Workflow.** Each option has costs:
   - **Switch nodes plus Mode-fixed booleans** fit "one Workflow per Model" and the official templates. But unused branches still validate: they need placeholder Uploads or installed LoRAs.
   - **`partial_execution_targets` per Mode** works only if Modes end in different output nodes.
   - **Graph pruning on the server per Mode** (delete or rewire nodes): flexible, but the studio has to re-implement bypass logic.
   - **Import the UI-format JSON and port `graphToPrompt`** (honours bypass groups and subgraphs): the most faithful to hand-built "all-in-one" Workflows, and by far the most code.
   - The charter says the LTX all-in-one Workflow switches Modes, so ticket 03 or 08 should check whether it uses switches or bypass groups. Bypass groups cannot be toggled from API JSON at all.
5. **How Inputs bind.**
   - Bind by node id (which can be a colon id for subgraphs) plus field name. Re-check the bindings whenever the admin re-uploads the Workflow.
   - Use `/object_info` to show the type, range and options of each Node field.
   - Repeatable Inputs (for example "up to 9 reference images") need **a new Input type that adds loader nodes and `<id>.<prefix><n>` links**. A plain field overwrite cannot do it; the alternative is to pre-wire the maximum and prune.
   - Seeds should stay below 2^53. Send booleans as JSON booleans.
6. **Uploads.**
   - Use unique names (UUID) under a per-Generation `subfolder`, with `overwrite=true`, so ComfyUI never renames them.
   - Raise `--max-upload-size` for video, or keep server-side trimming (charter #8) ahead of the upload.
   - Something outside ComfyUI must clean up `input/` and `output/` on Backends.
7. **Collecting Assets.**
   - Classify by extension or MIME across `images`, `gifs`, `audio` (and `animated`). Keep only `type=="output"`, optionally only from output nodes the admin names.
   - Copy files off the Backend promptly: re-running an identical cached graph returns the *same* file entry.
8. **Backend hardening** (pairs with charter #6):
   - Auth must come from the tunnel or proxy.
   - Bind `--listen` only to the tunnel interface. Leave `--enable-cors-header` off.
   - Consider `--disable-partner-nodes` (or `--offline`), and `--disable-metadata` if prompts must not be embedded in Assets.
   - Every Backend sees every other client's prompts.
9. **GPUs.**
   - One ComfyUI process per GPU gives one Backend each and parallel Generations.
   - Alternatively, one process spanning several GPUs with the MultiGPU nodes gives lower latency per Generation, one at a time.
10. **vLLM-Omni.**
    - (a) Skip it in v1 and use native ComfyUI nodes for all three Models.
    - (b) Use it *through* ComfyUI via its nodes. The "Model = Workflow" contract holds, but cancel, progress and auth are lost, and the vLLM-Omni server must be reachable from the ComfyUI host without credentials.
    - (c) Add a second Backend kind, "vLLM-Omni", where Inputs map to **form fields, not Node fields**. That would change the charter's Model shape.
    - The benefit is mainly H3, or LTX at 1080p two-stage, on multi-GPU hosts, plus batching for multi-generation.

## Open / unconfirmed

- Not verified live: nothing was run against a ComfyUI or vLLM-Omni server. Event ordering is inferred from the code paths.
- `/view` Range requests: they are served through aiohttp `FileResponse`, which normally honours Range for video seeking. Not tested here.
- Which ComfyUI release first accepted a client-supplied `prompt_id`: present in v0.42.4; the introducing commit was not pinned down.
- Whether vLLM-Omni's HTTP layer passes a **Wan 2.2 last frame** to the I2V pipeline. The pipeline accepts `last_image`, but `serving_video.py` maps only `image`, `video` and `audio`, and the ComfyUI node allows first/last only for H3.
- Wan 2.2 Animate through vLLM-Omni's generic diffusers adapter: no recipe and no test found.
- Whether `DELETE /api/assets/{id}` (opt-in assets system) removes the file on disk.
- The docs.comfy.org routes page says `POST /queue` clears running items too. The local `server.py` only dequeues pending ones; `openapi.yaml` describes the cloud behaviour.
- How much the MultiGPU CFG split speeds up LTX, Wan or H3: no figures found.
- WS through the chosen tunnel, and whether Bun's WebSocket client can send the tunnel's credential headers, belong to tickets 06 and 08.
- Native ComfyUI VRAM and GPU-count needs for H3 (versus vLLM-Omni's ≥2-GPU or offload recipes) belong to ticket 05.

## Sources (web)

- docs.comfy.org: Server routes — https://docs.comfy.org/development/comfyui-server/comms_routes
- docs.comfy.org: Server messages — https://docs.comfy.org/development/comfyui-server/comms_messages
- docs.comfy.org: API examples — https://docs.comfy.org/development/comfyui-server/api-examples
- docs.comfy.org: API key integration — https://docs.comfy.org/development/comfyui-server/api-key-integration
- vLLM-Omni ComfyUI integration docs — https://docs.vllm.ai/projects/vllm-omni/en/latest/features/comfyui/
- Repos (cloned and read, never executed): https://github.com/Comfy-Org/ComfyUI, https://github.com/Comfy-Org/ComfyUI_frontend, https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite, https://github.com/vllm-project/vllm-omni, https://github.com/Comfy-Org/workflow_templates
