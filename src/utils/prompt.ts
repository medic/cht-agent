/**
 * CLI Prompt Utilities
 *
 * Simple utilities for getting user input in the CLI
 * Uses Node.js built-in readline/promises module (Node 17+)
 */

import * as readline from 'node:readline/promises';

/**
 * Ask a question and get user input
 */
export const askQuestion = async (question: string): Promise<string> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
};

/**
 * Ask a yes/no question
 * Returns true for yes, false for no
 */
export const askYesNo = async (question: string): Promise<boolean> => {
  let validAnswer = false;
  let result = false;

  while (!validAnswer) {
    const answer = await askQuestion(`${question} [yes/no]: `);
    const normalized = answer.toLowerCase();

    if (normalized === 'yes' || normalized === 'y') {
      validAnswer = true;
      result = true;
    } else if (normalized === 'no' || normalized === 'n') {
      validAnswer = true;
      result = false;
    } else {
      console.log('Please answer "yes" or "no"');
    }
  }

  return result;
};

/**
 * Ask for multi-line feedback input
 * User enters empty line to finish
 */
export const askForFeedback = async (prompt: string): Promise<string> => {
  console.log(prompt);
  console.log('(Enter your feedback. Press Enter on empty line to finish)\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const lines: string[] = [];

  for await (const line of rl) {
    if (line === '') {
      break;
    }
    lines.push(line);
  }

  rl.close();
  return lines.join('\n').trim();
};
