#!/usr/bin/env node
/**
 * Integration test for the Vibe IDE agentic flow:
 * 1. Creates a sample BRD file
 * 2. Tests parseAgenticResponse (unit test)
 * 3. Sends the BRD to Ollama via direct HTTP, asks it to read + analyze + create gaps doc
 * 4. Parses the response and verifies actions are correctly extracted
 * 5. Executes the EDIT_FILE action to create the gaps document
 * 6. Verifies the gaps document exists on disk
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// ---- Config ----
const OLLAMA_HOST = 'http://192.168.10.160:11434';
const OLLAMA_MODEL = 'qwen3-coder-32k:latest';
const TEST_DIR = path.join(__dirname, 'test-workspace');
const BRD_PATH = path.join(TEST_DIR, 'SAMPLE_BRD.md');
const GAPS_PATH = path.join(TEST_DIR, 'BRD_GAPS.md');

// ---- Sample BRD ----
const SAMPLE_BRD = `# Business Requirements Document (BRD)
## Project: Customer Portal v2.0

### 1. Project Overview
The Customer Portal v2.0 will provide customers with a self-service platform to manage their accounts, view billing information, submit support tickets, and access documentation.

### 2. Business Objectives
- Reduce support call volume by 40%
- Increase customer satisfaction score to 4.5/5
- Enable 24/7 self-service account management

### 3. Functional Requirements

#### 3.1 User Authentication
- Users must be able to log in using email and password
- Support for OAuth2 (Google, Microsoft)
- Password reset via email

#### 3.2 Account Dashboard
- Display account summary with key metrics
- Show recent activity timeline
- Provide quick links to common actions

#### 3.3 Billing Module
- View current and past invoices
- Download invoices as PDF
- Update payment method
- Set up auto-pay

#### 3.4 Support Tickets
- Create new support tickets
- View status of existing tickets
- Attach files to tickets
- Receive email notifications on ticket updates

#### 3.5 Documentation Center
- Searchable knowledge base
- Video tutorials
- Getting started guides

### 4. Non-Functional Requirements
- Page load time under 3 seconds
- 99.9% uptime SLA
- Support for 10,000 concurrent users
- WCAG 2.1 AA accessibility compliance

### 5. Data Requirements
- All data must be encrypted at rest and in transit
- User data retained for 7 years after account closure
- Daily backups with 30-day retention

### 6. Integration Points
- CRM system (Salesforce)
- Payment gateway (Stripe)
- Email service (SendGrid)
- Analytics (Google Analytics)

### 7. User Roles
- Customer (standard user)
- Admin (internal staff)

### 8. Timeline
- Phase 1: Authentication + Dashboard (Q1)
- Phase 2: Billing + Support (Q2)  
- Phase 3: Documentation Center (Q3)
`;

// ---- parseAgenticResponse (extracted from app.js) ----
function parseAgenticResponse(content) {
  const actions = [];
  let text = content;

  // Collect all action blocks with their positions so we can sort by order of appearance
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

  // Sort by position in the original content
  allMatches.sort((a, b) => a.index - b.index);

  for (const m of allMatches) {
    if (m.type === 'read') {
      actions.push({ type: 'read', filePath: m.filePath, description: `Read ${m.filePath}` });
      text = text.replace(m.raw, `[READ: ${m.filePath}]`);
    } else if (m.type === 'edit') {
      actions.push({ type: 'edit', filePath: m.filePath, content: m.content, description: `Write to ${m.filePath}` });
      text = text.replace(m.raw, `[EDIT: ${m.filePath}]`);
    } else if (m.type === 'command') {
      actions.push({ type: 'command', command: m.command, description: m.command });
      text = text.replace(m.raw, `[CMD: ${m.command}]`);
    }
  }

  return { text: text.trim(), actions };
}

// ---- Ollama HTTP helper ----
function ollamaFetch(endpoint, body, timeout = 300000) {
  return new Promise((resolve, reject) => {
    const url = `${OLLAMA_HOST}${endpoint}`;
    const postData = body ? JSON.stringify(body) : null;
    const urlObj = new URL(url);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 11434,
      path: urlObj.pathname,
      method: postData ? 'POST' : 'GET',
      headers: {},
    };

    if (postData) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`Timeout after ${timeout}ms`));
    }, timeout);

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        clearTimeout(timer);
        resolve(data);
      });
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    if (postData) req.write(postData);
    req.end();
  });
}

// ---- Test helpers ----
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ ${msg}`);
    failed++;
  }
}

// ---- Tests ----
async function runTests() {
  console.log('\n=== Vibe IDE BRD Analysis Flow Test ===\n');

  // ---- Test 1: parseAgenticResponse with READ_FILE ----
  console.log('Test 1: parseAgenticResponse handles READ_FILE');
  {
    const input = `I'll read the file first.\n<READ_FILE path="/tmp/test.md">\n</READ_FILE>`;
    const { text, actions } = parseAgenticResponse(input);
    assert(actions.length === 1, `Expected 1 action, got ${actions.length}`);
    assert(actions[0]?.type === 'read', `Expected type=read, got ${actions[0]?.type}`);
    assert(actions[0]?.filePath === '/tmp/test.md', `Expected path=/tmp/test.md, got ${actions[0]?.filePath}`);
    assert(text.includes('[READ:'), `Text should contain [READ:], got: ${text.substring(0, 80)}`);
  }

  // ---- Test 2: parseAgenticResponse with EDIT_FILE ----
  console.log('\nTest 2: parseAgenticResponse handles EDIT_FILE');
  {
    const input = `Creating a file.\n<EDIT_FILE path="/tmp/gaps.md">\n# Gaps\n- Gap 1\n</EDIT_FILE>`;
    const { text, actions } = parseAgenticResponse(input);
    assert(actions.length === 1, `Expected 1 action, got ${actions.length}`);
    assert(actions[0]?.type === 'edit', `Expected type=edit, got ${actions[0]?.type}`);
    assert(actions[0]?.filePath === '/tmp/gaps.md', `Expected path=/tmp/gaps.md, got ${actions[0]?.filePath}`);
    assert(actions[0]?.content.includes('# Gaps'), `Content should include '# Gaps'`);
  }

  // ---- Test 3: parseAgenticResponse with mixed actions ----
  console.log('\nTest 3: parseAgenticResponse handles mixed READ + EDIT + CMD');
  {
    const input = `Let me read first.\n<READ_FILE path="/tmp/brd.md">\n</READ_FILE>\nNow creating gaps.\n<EDIT_FILE path="/tmp/gaps.md">\n# Gaps found\n</EDIT_FILE>\nListing dir.\n<RUN_CMD>\nls -la /tmp\n</RUN_CMD>`;
    const { text, actions } = parseAgenticResponse(input);
    assert(actions.length === 3, `Expected 3 actions, got ${actions.length}`);
    assert(actions[0]?.type === 'read', `First action should be read, got ${actions[0]?.type}`);
    assert(actions[1]?.type === 'edit', `Second action should be edit, got ${actions[1]?.type}`);
    assert(actions[2]?.type === 'command', `Third action should be command, got ${actions[2]?.type}`);
  }

  // ---- Test 4: Setup test workspace and BRD ----
  console.log('\nTest 4: Create test workspace and sample BRD');
  {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.writeFileSync(BRD_PATH, SAMPLE_BRD);
    assert(fs.existsSync(BRD_PATH), `BRD file created at ${BRD_PATH}`);
    const content = fs.readFileSync(BRD_PATH, 'utf-8');
    assert(content.includes('Customer Portal'), 'BRD contains expected content');
  }

  // ---- Test 5: Check Ollama connectivity ----
  console.log('\nTest 5: Ollama server connectivity');
  {
    try {
      const raw = await ollamaFetch('/api/tags', null, 10000);
      const data = JSON.parse(raw);
      assert(Array.isArray(data.models), `Ollama reachable, ${data.models.length} models available`);
      const hasModel = data.models.some(m => m.name === OLLAMA_MODEL || m.name.startsWith(OLLAMA_MODEL.split(':')[0]));
      assert(hasModel, `Model ${OLLAMA_MODEL} is available`);
    } catch (err) {
      assert(false, `Ollama not reachable: ${err.message}`);
      console.log('\n  Cannot continue without Ollama. Stopping.\n');
      printSummary();
      process.exit(1);
    }
  }

  // ---- Test 6: Simulate Step 1 - Ask model to read + analyze BRD ----
  console.log('\nTest 6: Ask Ollama to read and analyze BRD (Step 1 - model should emit READ_FILE)');
  {
    const systemPrompt = `You are an AI coding assistant embedded in Vibe IDE. You help the user with coding tasks on their local machine.

Working directory: ${TEST_DIR}
Currently browsing: ${TEST_DIR}

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
Always use absolute paths. The working directory is ${TEST_DIR}.
Be proactive: if the user asks you to build something, write the code and create the files.
If you need to read a file first, use READ_FILE. The file contents will be shown to you.
If you need to install packages, use the RUN_CMD block.
`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Read the file ${BRD_PATH}, analyze it for gaps or missing requirements, and create a new file called ${GAPS_PATH} documenting all gaps and discrepancies found.` },
    ];

    console.log('  Sending to Ollama (this may take 30-120 seconds)...');
    try {
      const raw = await ollamaFetch('/api/chat', { model: OLLAMA_MODEL, messages, stream: false }, 300000);
      const data = JSON.parse(raw);
      const content = data.message?.content || '';
      const thinking = data.message?.thinking || '';
      
      console.log(`  Response: content=${content.length} chars, thinking=${thinking.length} chars`);
      console.log(`  First 300 chars of content:\n    ${content.substring(0, 300).replace(/\n/g, '\n    ')}`);

      const { text, actions } = parseAgenticResponse(content);
      console.log(`  Parsed: ${actions.length} actions, text=${text.length} chars`);
      for (const a of actions) {
        console.log(`    -> ${a.type}: ${a.filePath || a.command || '?'}`);
      }

      const hasRead = actions.some(a => a.type === 'read');
      const hasEdit = actions.some(a => a.type === 'edit');

      if (hasRead && !hasEdit) {
        // Model wants to READ first — simulate the auto-follow-up
        assert(true, 'Model correctly requested READ_FILE first');
        
        const readAction = actions.find(a => a.type === 'read');
        console.log(`\n  Simulating READ_FILE execution for: ${readAction.filePath}`);
        
        let fileContent;
        try {
          fileContent = fs.readFileSync(readAction.filePath, 'utf-8');
          assert(true, `File read successfully (${fileContent.split('\n').length} lines)`);
        } catch (err) {
          assert(false, `Failed to read file: ${err.message}`);
          printSummary();
          process.exit(1);
        }

        const preview = fileContent.split('\n').length > 100 
          ? fileContent.split('\n').slice(0, 100).join('\n') + '\n... (truncated)' 
          : fileContent;

        // Step 2: Send follow-up with file contents
        console.log('\nTest 7: Follow-up with file contents (Step 2 - model should produce EDIT_FILE for gaps doc)');
        const followUpMessages = [
          ...messages,
          { role: 'assistant', content },
          { role: 'user', content: `[File contents of ${readAction.filePath}]:\n${preview}` },
          { role: 'user', content: 'The file contents have been provided above. Now continue with the original request: analyze the file and perform any requested actions. Do NOT use READ_FILE again for files already shown. Use EDIT_FILE to create the gaps document.' },
        ];

        console.log('  Sending follow-up to Ollama...');
        const raw2 = await ollamaFetch('/api/chat', { model: OLLAMA_MODEL, messages: followUpMessages, stream: false }, 300000);
        const data2 = JSON.parse(raw2);
        const content2 = data2.message?.content || '';

        console.log(`  Follow-up response: ${content2.length} chars`);
        console.log(`  First 300 chars:\n    ${content2.substring(0, 300).replace(/\n/g, '\n    ')}`);

        const parsed2 = parseAgenticResponse(content2);
        console.log(`  Parsed: ${parsed2.actions.length} actions`);
        for (const a of parsed2.actions) {
          console.log(`    -> ${a.type}: ${a.filePath || a.command || '?'}`);
        }

        const editAction = parsed2.actions.find(a => a.type === 'edit');
        assert(parsed2.actions.length > 0, `Follow-up produced ${parsed2.actions.length} actions`);
        assert(!!editAction, 'Follow-up includes an EDIT_FILE action');

        if (editAction) {
          assert(
            editAction.filePath.includes('GAPS') || editAction.filePath.includes('gaps'),
            `Edit target contains 'gaps': ${editAction.filePath}`
          );

          // Execute the edit action
          console.log(`\n  Executing EDIT_FILE: ${editAction.filePath}`);
          const editDir = path.dirname(editAction.filePath);
          if (!fs.existsSync(editDir)) fs.mkdirSync(editDir, { recursive: true });
          fs.writeFileSync(editAction.filePath, editAction.content);
          
          assert(fs.existsSync(editAction.filePath), `Gaps file created: ${editAction.filePath}`);
          const gapsContent = fs.readFileSync(editAction.filePath, 'utf-8');
          assert(gapsContent.length > 50, `Gaps file has meaningful content (${gapsContent.length} chars)`);
          console.log(`\n  === Gaps document preview (first 500 chars) ===`);
          console.log(`  ${gapsContent.substring(0, 500).replace(/\n/g, '\n  ')}`);
        }

      } else if (hasEdit) {
        // Model produced EDIT_FILE directly (it may have inlined the analysis)
        assert(true, 'Model produced EDIT_FILE directly without needing READ first');
        
        const editAction = actions.find(a => a.type === 'edit');
        assert(
          editAction.filePath.includes('GAPS') || editAction.filePath.includes('gaps'),
          `Edit target looks like gaps doc: ${editAction.filePath}`
        );

        // Also execute any reads first
        for (const a of actions.filter(a => a.type === 'read')) {
          console.log(`  (Also has READ: ${a.filePath})`);
        }

        // Execute the edit
        console.log(`  Executing EDIT_FILE: ${editAction.filePath}`);
        const editDir = path.dirname(editAction.filePath);
        if (!fs.existsSync(editDir)) fs.mkdirSync(editDir, { recursive: true });
        fs.writeFileSync(editAction.filePath, editAction.content);

        assert(fs.existsSync(editAction.filePath), `Gaps file created: ${editAction.filePath}`);
        const gapsContent = fs.readFileSync(editAction.filePath, 'utf-8');
        assert(gapsContent.length > 50, `Gaps file has meaningful content (${gapsContent.length} chars)`);
        console.log(`\n  === Gaps document preview (first 500 chars) ===`);
        console.log(`  ${gapsContent.substring(0, 500).replace(/\n/g, '\n  ')}`);

      } else {
        assert(false, `Model did not produce READ or EDIT actions. Content starts with: ${content.substring(0, 200)}`);
        console.log('\n  DIAGNOSIS: The model responded with plain text instead of action blocks.');
        console.log('  This suggests the system prompt is not being followed correctly.');
        console.log(`  Full content:\n${content}`);
      }

    } catch (err) {
      assert(false, `Ollama chat failed: ${err.message}`);
    }
  }

  printSummary();
}

function printSummary() {
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
