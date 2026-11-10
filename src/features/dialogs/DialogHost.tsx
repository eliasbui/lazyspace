import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SheetFrame } from '@/components/macos/SheetFrame';
import { useT } from '@/i18n';
import { closeSheet, useRegistry, useSheets } from '@/lib/registry';
import { useDialogs, type PromptRequest } from '@/lib/ui';

/** The two small questions every feature asks: a yes or no, and a typed answer. */
export function DialogHost() {
  const { confirm, prompt } = useDialogs();
  const t = useT();
  return (
    <>
      <SheetFrame
        open={!!confirm}
        onClose={() => confirm?.resolve(false)}
        size="sm"
        title={confirm?.title}
        footer={
          <>
            <Button onPress={() => confirm?.resolve(false)}>{t('cancel')}</Button>
            <Button variant="default" autoFocus onPress={() => confirm?.resolve(true)}>
              {confirm?.yes}
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-snug text-fg-2">{confirm?.text}</p>
      </SheetFrame>
      {prompt ? <PromptDialog key={prompt.title} request={prompt} /> : null}
    </>
  );
}

function PromptDialog({ request }: { request: PromptRequest }) {
  const t = useT();
  const [value, setValue] = useState(request.value);
  return (
    <SheetFrame
      open
      onClose={() => request.resolve(null)}
      size="sm"
      title={request.title}
      footer={
        <>
          <Button onPress={() => request.resolve(null)}>{t('cancel')}</Button>
          <Button variant="default" onPress={() => request.resolve(value)}>
            {request.ok}
          </Button>
        </>
      }
    >
      {request.text ? <p className="mb-2 text-[13px] leading-snug text-fg-2">{request.text}</p> : null}
      <Input
        autoFocus
        aria-label={request.title}
        type={request.secret ? 'password' : 'text'}
        value={value}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') request.resolve(value);
        }}
      />
    </SheetFrame>
  );
}

/** Draws the sheet that is open, if any; the sheet is a component a feature registered. */
export function SheetHost() {
  const open = useSheets((s) => s.open);
  const sheets = useRegistry((s) => s.sheets);
  const sheet = open ? sheets[open.id] : undefined;
  if (!open || !sheet) return null;
  const { Component } = sheet;
  return <Component props={open.props as never} close={closeSheet} />;
}
