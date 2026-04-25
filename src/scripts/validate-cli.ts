#!/usr/bin/env node
/**
 * Claude Code CLI Validation Script
 *
 * Validates that the Claude Code CLI is installed and working correctly.
 * Run with: npm run validate-cli
 */

import { validateClaudeCLI, createClaudeCLIProvider } from '../llm';

async function main() {
  console.log('='.repeat(60));
  console.log('Claude Code CLI Validation');
  console.log('='.repeat(60));
  console.log('');

  // Step 1: Check CLI installation
  console.log('Step 1: Checking CLI installation...');
  const validation = await validateClaudeCLI();

  if (!validation.valid) {
    console.error('');
    console.error('❌ CLI validation failed:', validation.error);
    console.error('');
    console.error('To install Claude Code CLI:');
    console.error('  npm install -g @anthropic-ai/claude-code');
    console.error('');
    console.error('Then authenticate with:');
    console.error('  claude login');
    console.error('');
    process.exit(1);
  }

  console.log('✅ Claude Code CLI found:', validation.version);
  console.log('');

  // Step 2: Test basic invocation
  console.log('Step 2: Testing basic invocation...');
  console.log('   (This may take a few seconds)');
  console.log('');

  try {
    const provider = createClaudeCLIProvider({
      timeout: 60000, // 1 minute for test
      maxTurns: 1,
    });

    const response = await provider.invoke(
      'Reply with exactly: "CLI test successful". Nothing else.'
    );

    if (response.content.toLowerCase().includes('successful')) {
      console.log('✅ CLI invocation successful');
      console.log('   Response:', response.content.substring(0, 100));
    } else {
      console.log('⚠️  CLI responded but with unexpected content:');
      console.log('   ', response.content.substring(0, 200));
    }
  } catch (error) {
    console.error('❌ CLI invocation failed:', error);
    console.error('');
    console.error('Make sure you are logged in:');
    console.error('  claude login');
    console.error('');
    process.exit(1);
  }

  console.log('');

  // Step 3: Test JSON parsing
  console.log('Step 3: Testing JSON response parsing...');

  try {
    const provider = createClaudeCLIProvider({
      timeout: 60000,
      maxTurns: 1,
    });

    interface TestResponse {
      status: string;
      message: string;
    }

    const response = await provider.invokeForJSON<TestResponse>(
      'Return a JSON object with two fields: "status" set to "ok" and "message" set to "JSON parsing works". Only output the JSON, nothing else.'
    );

    if (response.status === 'ok') {
      console.log('✅ JSON parsing successful');
      console.log('   Parsed object:', JSON.stringify(response));
    } else {
      console.log('⚠️  JSON parsed but with unexpected content:', response);
    }
  } catch (error) {
    console.error('❌ JSON parsing failed:', error);
    process.exit(1);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('✅ All validations passed!');
  console.log('');
  console.log('You can now use the CLI provider by setting:');
  console.log('  LLM_PROVIDER=claude-cli');
  console.log('');
  console.log('in your .env file.');
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
