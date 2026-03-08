#!/usr/bin/env node
/**
 * Integration test for the architecture pipeline:
 * 1. Simulates the exact flow: router classify → planner plan → coder execute
 * 2. Tests with the real X4 directory restructuring scenario
 * 3. Checks that the coder produces multiple EDIT_FILE/RUN_CMD blocks (not just 1)
 * 4. Logs token counts and response sizes to diagnose truncation
 */

const http = require('http');
const path = require('path');

// ---- Config ----
const OLLAMA_HOST = 'http://192.168.10.160:11434';
const ROUTER_MODEL = 'qwen3:4b';
const PLANNER_MODEL = 'qwen3:32b';
const CODER_MODEL = 'qwen3-coder-next:latest';
const WORKING_DIR = '/home/rob/src/x4';

// ---- Ollama HTTP helper ----
function ollamaChat(model, messages, num_ctx, timeout = 900000) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${OLLAMA_HOST}/api/chat`);
    const body = JSON.stringify({
      model,
      messages,
      stream: false,
      options: { num_ctx },
    });

    const req = http.request({
      hostname: url.hostname,
      port: url.port || 11434,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Parse error: ${data.substring(0, 500)}`));
        }
      });
    });

    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`Timeout after ${timeout}ms`));
    }, timeout);

    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.write(body);
    req.end();
  });
}

// ---- Parse agentic response (same as app.js) ----
function parseAgenticResponse(content) {
  const actions = [];
  let text = content;
  const allMatches = [];

  const readRegex = /<READ_FILE\s+path="([^"]+)">[\s\S]*?<\/READ_FILE>/g;
  let match;
  while ((match = readRegex.exec(content)) !== null) {
    allMatches.push({ index: match.index, raw: match[0], type: 'read', filePath: match[1] });
  }

  const editRegex = /<EDIT_FILE\s+path="([^"]+)">\n?([\s\S]*?)<\/EDIT_FILE>/g;
  while ((match = editRegex.exec(content)) !== null) {
    allMatches.push({ index: match.index, raw: match[0], type: 'edit', filePath: match[1], content: match[2].trimEnd() });
  }

  const cmdRegex = /<RUN_CMD>\n?([\s\S]*?)<\/RUN_CMD>/g;
  while ((match = cmdRegex.exec(content)) !== null) {
    allMatches.push({ index: match.index, raw: match[0], type: 'command', command: match[1].trim() });
  }

  allMatches.sort((a, b) => a.index - b.index);

  for (const m of allMatches) {
    if (m.type === 'read') actions.push({ type: 'read', filePath: m.filePath });
    else if (m.type === 'edit') actions.push({ type: 'edit', filePath: m.filePath, contentLen: m.content.length });
    else if (m.type === 'command') actions.push({ type: 'command', command: m.command });
  }

  return { text: text.trim(), actions };
}

// ---- Simulated directory listing (what the EISDIR fallback returns) ----
const X4_DIR_LISTING = `📁 api/ (4096 bytes)
📁 app/ (4096 bytes)
📁 docs/ (4096 bytes)
📁 e2e/ (4096 bytes)
📁 entities/ (4096 bytes)
📁 frameworks_drivers/ (4096 bytes)
📁 frontend/ (4096 bytes)
📁 interface_adapters/ (4096 bytes)
📁 src/ (4096 bytes)
📁 tests/ (4096 bytes)
📁 use_cases/ (4096 bytes)
📄 architecture.md (4611 bytes)
📄 main.py (2139 bytes)
📄 package.json (108 bytes)
📄 requirements.txt (259 bytes)`;

const USER_INPUT = "I would like the structure of the x4 directory to follow clean architecture guidelines, there seem to be files for different parts all over the place (api, tests, front-end, etc)";

// ---- System prompt (matches app.js buildSystemPrompt) ----
function buildSystemPrompt(isArchitecture) {
  let prompt = `You are an AI coding assistant embedded in Vibe IDE. You help the user with coding tasks on their local machine.

Working directory: ${WORKING_DIR}
Currently browsing: ${WORKING_DIR}
`;

  prompt += `
AGENTIC MODE IS ON. You can perform actions by including special blocks in your response:

To read a file:
<READ_FILE path="/absolute/path/to/file">
</READ_FILE>

To edit/create a file:
<EDIT_FILE path="/absolute/path/to/file">
file contents here
</EDIT_FILE>

To run a shell command:
<RUN_CMD>
command here
</RUN_CMD>

You can include multiple actions. Explain what you're doing before each action.
Always use absolute paths. The working directory is ${WORKING_DIR}.
Be proactive: if the user asks you to build something, write the code and create the files.
If you need to read a file first, use READ_FILE. The file contents will be shown to you.
If you need to install packages, use the RUN_CMD block.
To move or rename files, use RUN_CMD with mv commands.
To delete files, use RUN_CMD with rm commands.
To create directories, use RUN_CMD with mkdir -p commands.
`;

  if (isArchitecture) {
    prompt += `
ARCHITECTURE MODE: A planner model has already created a detailed plan for you.
Your ONLY job is to EXECUTE that plan by producing EDIT_FILE and RUN_CMD blocks.
DO NOT explain, summarize, or describe what you plan to do.
DO NOT use READ_FILE unless absolutely necessary — the plan already tells you what to create.
START your response with action blocks immediately.
Produce ALL files in ONE response. Do not stop early.
`;
  }

  return prompt;
}

// ---- Main test ----
async function main() {
  console.log('='.repeat(70));
  console.log('ARCHITECTURE PIPELINE TEST');
  console.log('='.repeat(70));

  // ---- Step 1: Router classification ----
  console.log('\n--- Step 1: Router Classification ---');
  const routerStart = Date.now();
  const routerResult = await ollamaChat(ROUTER_MODEL, [{
    role: 'user',
    content: `Classify this user request into exactly one category.
Categories:
- architecture: multi-file scaffolding, restructuring directories, design decisions
- code: single-file edits, bug fixes, writing one function
- general: questions, explanations
- vision: image analysis (only if image attached)

Request: "${USER_INPUT}"

Respond with ONLY the category name, nothing else.`,
  }], 2048, 60000);

  const routerContent = routerResult.message?.content?.trim().toLowerCase() || '';
  const routerTime = Date.now() - routerStart;
  console.log(`Router response: "${routerContent}" (${routerTime}ms)`);
  console.log(`Eval count: ${routerResult.eval_count || 'N/A'}, Prompt tokens: ${routerResult.prompt_eval_count || 'N/A'}`);

  if (!routerContent.includes('architecture')) {
    console.log('⚠ Router did NOT classify as architecture — this may be part of the problem.');
  } else {
    console.log('✅ Correctly classified as architecture');
  }

  // ---- Step 2: Planner ----
  console.log('\n--- Step 2: Planner (qwen3:32b) ---');
  const plannerStart = Date.now();

  // Include the directory listing as context (simulating what the IDE would have in chat history)
  const plannerMessages = [
    { role: 'system', content: `You are an expert software architect. Given a user request and a codebase context, produce a detailed plan.
Your plan MUST include:
1. Summary of approach
2. Numbered list of files to create/move/modify with details
3. Dependencies between files
4. Order of creation/execution` },
    { role: 'user', content: `${USER_INPUT}\n\nCurrent directory listing of ${WORKING_DIR}:\n${X4_DIR_LISTING}` },
  ];

  const plannerResult = await ollamaChat(PLANNER_MODEL, plannerMessages, 16384, 300000);
  const plannerContent = plannerResult.message?.content || '';
  const plannerTime = Date.now() - plannerStart;
  console.log(`Planner response length: ${plannerContent.length} chars (${plannerTime}ms)`);
  console.log(`Eval count: ${plannerResult.eval_count || 'N/A'}, Prompt tokens: ${plannerResult.prompt_eval_count || 'N/A'}`);
  console.log(`Plan preview (first 500 chars):\n${plannerContent.substring(0, 500)}`);
  console.log('...');

  // ---- Step 3: Coder ----
  console.log('\n--- Step 3: Coder (qwen3-coder-next) ---');
  const coderStart = Date.now();

  const userContent = `USER REQUEST: ${USER_INPUT}\n\n---\nARCHITECTURE PLAN (from planner model — you MUST execute this NOW):\n${plannerContent}\n---\n\nIMPORTANT INSTRUCTIONS:\n- You MUST produce action blocks (EDIT_FILE, RUN_CMD) in THIS response to implement the plan above.\n- Do NOT just describe what you will do. Actually DO it with action blocks.\n- Use EDIT_FILE to create/write files with their full contents.\n- Use RUN_CMD for mkdir, mv, rm, pip install, npm install, etc.\n- Create ALL files listed in the plan in a SINGLE response.\n- Start with a 1-2 sentence summary, then immediately output action blocks.`;

  const coderMessages = [
    { role: 'system', content: buildSystemPrompt(true) },
    { role: 'user', content: `[Directory listing of ${WORKING_DIR}]:\n${X4_DIR_LISTING}` },
    { role: 'user', content: userContent },
  ];

  // Log message sizes
  const totalChars = coderMessages.reduce((s, m) => s + m.content.length, 0);
  console.log(`Sending ${coderMessages.length} messages to coder (${totalChars} total chars)`);

  const coderResult = await ollamaChat(CODER_MODEL, coderMessages, 32768, 900000);
  const coderContent = coderResult.message?.content || '';
  const coderTime = Date.now() - coderStart;

  console.log(`\nCoder response length: ${coderContent.length} chars (${coderTime}ms)`);
  console.log(`Eval count (output tokens): ${coderResult.eval_count || 'N/A'}`);
  console.log(`Prompt eval count (input tokens): ${coderResult.prompt_eval_count || 'N/A'}`);
  console.log(`Done reason: ${coderResult.done_reason || 'N/A'}`);
  console.log(`Total duration: ${coderResult.total_duration ? (coderResult.total_duration / 1e9).toFixed(1) + 's' : 'N/A'}`);

  // ---- Step 4: Parse and analyze ----
  console.log('\n--- Step 4: Parse Agentic Response ---');
  const { text, actions } = parseAgenticResponse(coderContent);

  console.log(`Text length (non-action): ${text.length} chars`);
  console.log(`Total actions parsed: ${actions.length}`);

  const readActions = actions.filter(a => a.type === 'read');
  const editActions = actions.filter(a => a.type === 'edit');
  const cmdActions = actions.filter(a => a.type === 'command');

  console.log(`  READ_FILE: ${readActions.length}`);
  console.log(`  EDIT_FILE: ${editActions.length}`);
  console.log(`  RUN_CMD:   ${cmdActions.length}`);

  if (editActions.length > 0) {
    console.log('\nEDIT_FILE targets:');
    editActions.forEach((a, i) => console.log(`  ${i + 1}. ${a.filePath} (${a.contentLen} chars)`));
  }
  if (cmdActions.length > 0) {
    console.log('\nRUN_CMD commands:');
    cmdActions.forEach((a, i) => console.log(`  ${i + 1}. ${a.command}`));
  }
  if (readActions.length > 0) {
    console.log('\nREAD_FILE targets:');
    readActions.forEach((a, i) => console.log(`  ${i + 1}. ${a.filePath}`));
  }

  // ---- Step 5: Diagnosis ----
  console.log('\n--- Step 5: Diagnosis ---');
  if (actions.length === 0) {
    console.log('❌ FAIL: Coder produced ZERO action blocks.');
    console.log('Raw response preview (first 1000 chars):');
    console.log(coderContent.substring(0, 1000));
  } else if (actions.length === 1) {
    console.log('⚠ PARTIAL: Coder produced only 1 action — likely truncated or stopping early.');
    console.log(`done_reason: ${coderResult.done_reason} (expected "stop" for complete response, "length" means hit token limit)`);
    console.log('Raw response (full):');
    console.log(coderContent);
  } else if (readActions.length > 0 && editActions.length === 0 && cmdActions.length === 0) {
    console.log('⚠ PARTIAL: Coder only produced READ_FILE actions — it wants to read before acting.');
    console.log('This means the follow-up loop will need to trigger, but the coder should act directly from the plan.');
  } else if (actions.length >= 3) {
    console.log(`✅ PASS: Coder produced ${actions.length} action blocks — pipeline is working.`);
  } else {
    console.log(`⚠ LOW: Only ${actions.length} actions. May need more output tokens.`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('TEST COMPLETE');
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('Test failed with error:', err.message);
  process.exit(1);
});
