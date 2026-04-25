/**
 * CLI Prompt Utilities
 *
 * Simple utilities for getting user input in the CLI
 * Uses Node.js built-in readline/promises module (Node 17+)
 */

import * as readline from 'readline/promises';

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

/**
 * Display a confirmation prompt with options
 */
export const askWithOptions = async (
  question: string,
  options: string[]
): Promise<string> => {
  const optionsDisplay = options.map((opt, i) => `  ${i + 1}. ${opt}`).join('\n');
  let selectedOption: string | null = null;

  while (selectedOption === null) {
    console.log(`\n${question}`);
    console.log(optionsDisplay);

    const answer = await askQuestion('\nEnter your choice (number or text): ');

    // Check if it's a number
    const num = parseInt(answer, 10);
    if (!isNaN(num) && num >= 1 && num <= options.length) {
      selectedOption = options[num - 1];
    } else {
      // Check if it matches an option (case insensitive)
      const match = options.find(
        (opt) => opt.toLowerCase() === answer.toLowerCase()
      );
      if (match) {
        selectedOption = match;
      } else {
        console.log(`Invalid choice. Please select 1-${options.length} or type an option.`);
      }
    }
  }

  return selectedOption;
};

/**
 * Display a spinner while waiting (simple version)
 */
export const displayWaiting = (message: string): (() => void) => {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;

  const interval = setInterval(() => {
    process.stdout.write(`\r${frames[i]} ${message}`);
    i = (i + 1) % frames.length;
  }, 80);

  // Return a function to stop the spinner
  return () => {
    clearInterval(interval);
    process.stdout.write('\r' + ' '.repeat(message.length + 3) + '\r');
  };
};
