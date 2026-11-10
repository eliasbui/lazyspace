// The small dialogs and notes every feature uses: a toast, an error said in words, a question with two answers, a question
// with a typed answer. The state is here; src/features/dialogs draws it.
import { toast as sonner } from 'sonner';
import { create } from 'zustand';

/** A note in the corner of the window. */
export function toast(text: string): void {
  sonner(text, { duration: 3600 });
}

/** The words of an error from the app or from a promise, as a note. */
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^LZ-[A-Z]+:/, '');
}

/** Says an error as a toast; for `.catch(say)`. */
export function say(error: unknown): void {
  toast(errorText(error));
}

export interface ConfirmRequest {
  title: string;
  text: string;
  yes: string;
  resolve: (answer: boolean) => void;
}

export interface PromptRequest {
  title: string;
  text: string;
  value: string;
  secret: boolean;
  ok: string;
  resolve: (answer: string | null) => void;
}

export const useDialogs = create<{ confirm: ConfirmRequest | null; prompt: PromptRequest | null }>(() => ({ confirm: null, prompt: null }));

/** A question with two answers, as a sheet; resolves true for the first. */
export function confirm(title: string, text: string, yes: string): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogs.setState({
      confirm: {
        title,
        text,
        yes,
        resolve: (answer) => {
          useDialogs.setState({ confirm: null });
          resolve(answer);
        },
      },
    });
  });
}

/** A question with a typed answer, as a sheet: resolves the text, or null when cancelled. `secret` hides what is typed. */
export function prompt(title: string, options: { text?: string; value?: string; secret?: boolean; ok: string }): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogs.setState({
      prompt: {
        title,
        text: options.text ?? '',
        value: options.value ?? '',
        secret: options.secret ?? false,
        ok: options.ok,
        resolve: (answer) => {
          useDialogs.setState({ prompt: null });
          resolve(answer);
        },
      },
    });
  });
}
