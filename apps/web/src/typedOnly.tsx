import { PasswordInput, type PasswordInputProps, TextInput, type TextInputProps } from '@mantine/core';
import { type ChangeEvent, useCallback, useRef } from 'react';

/**
 * Change handlers for a box only the person fills: a change counts once they type, paste, drop, cut or dictate into it
 * (a trusted beforeinput) during this visit to the box. A password manager fills a box without any of those, so what it
 * puts in is dropped and the box keeps its value. LastPass ignored every "leave this alone" mark and filled a sign-in
 * password into key boxes and the sign-in name into the email username (0.60.0); the server refuses a key that's an
 * account's password too.
 */
export function useTypedOnly(onValue: (value: string) => void) {
  const typed = useRef(false);
  const ref = useCallback((el: HTMLInputElement | null) => {
    el?.addEventListener('beforeinput', (event) => {
      const e = event as InputEvent;
      // A replacement (a spelling fix, and how some browsers autofill) counts only after the person started typing.
      if (e.isTrusted && (e.inputType !== 'insertReplacementText' || typed.current)) typed.current = true;
    });
  }, []);
  return {
    ref,
    onBlur: () => {
      typed.current = false;
    },
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      if (typed.current) onValue(e.currentTarget.value);
    },
  };
}

/** A text box only the person fills (useTypedOnly). */
export function TypedTextInput({ onValue, ...props }: Omit<TextInputProps, 'onChange' | 'onBlur'> & { onValue: (value: string) => void }) {
  return <TextInput {...props} {...useTypedOnly(onValue)} />;
}

/** A key or password box for another service, only the person fills (useTypedOnly). */
export function TypedPasswordInput({ onValue, ...props }: Omit<PasswordInputProps, 'onChange' | 'onBlur'> & { onValue: (value: string) => void }) {
  return <PasswordInput {...props} {...useTypedOnly(onValue)} />;
}
