// The sheet that adds or edits a connection, or signs in to a cloud through rclone (Cmd+K, Finder's "Connect to Server").
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { SheetFrame } from '@/components/macos/SheetFrame';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { useT, type WordKey } from '@/i18n';
import type { SheetProps } from '@/lib/registry';
import { errorText, toast } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { api, messageOf, type CloudKind, type Connection } from '@/services';
import { CLOUDS, described, emptyForm, formOf, isCloudKind, isMounted, isS3, KINDS, MICROSOFT, PORTS, problems, shownFields, TRUST, type FieldName, type ServerForm } from './kinds';
import { ask, byId, load, openConnection, signIn, useRemote } from './store';

/** Opened with nothing for a new connection, `conn` to edit one, `cloud` to sign in to that cloud through rclone. */
export interface ServerSheetProps {
  conn?: Connection | null;
  cloud?: CloudKind;
}

function Row({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <Field className="grid grid-cols-[11rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
      <FieldLabel htmlFor={id} className="justify-end text-right text-[13px] leading-tight font-normal text-fg-2">
        {label}
      </FieldLabel>
      {children}
      {error ? <FieldError className="col-start-2 text-[12px] leading-snug">{error}</FieldError> : null}
    </Field>
  );
}

export function ServerSheet({ props, close }: SheetProps<ServerSheetProps | undefined>) {
  const t = useT();
  const editing = props?.conn ?? null;
  const [form, setForm] = useState<ServerForm>(() => (editing ? formOf(editing) : props?.cloud ? emptyForm('rclone', props.cloud) : emptyForm()));
  // Problems show once the form was sent, then follow the typing.
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState<{ text: string; good: boolean } | null>(null);
  const [trying, setTrying] = useState(false);
  const remotes = useRemote((s) => s.rclone.remotes);
  const base = useId();
  // Whether rclone is installed may have changed since the list was loaded.
  useEffect(() => void load(), []);

  const { kind } = form;
  const shown = shownFields(form);
  const found = problems(form, remotes);
  const errors = checked ? found : {};
  const s3 = isS3(kind);
  const mounted = isMounted(kind);
  const share = kind === 'smb' || kind === 'afp';
  const rclone = kind === 'rclone';

  const set = <K extends keyof ServerForm>(key: K, value: ServerForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setNote(null);
  };
  const fieldId = (f: FieldName) => `${base}-${f}`;
  const errorOf = (f: FieldName): string | undefined => {
    const key = errors[f];
    return key ? t(key) : undefined;
  };
  const text = (f: Exclude<FieldName, 'cloud' | 'guest' | 'advanced'>, label: WordKey, options: { placeholder?: string; secret?: boolean; autoFocus?: boolean } = {}) =>
    shown.has(f) ? (
      <Row key={f} id={fieldId(f)} label={t(label)} error={errorOf(f)}>
        <Input
          id={fieldId(f)}
          className="h-7"
          value={form[f]}
          type={options.secret ? 'password' : 'text'}
          placeholder={options.placeholder}
          spellCheck={false}
          autoComplete="off"
          autoFocus={options.autoFocus}
          aria-invalid={!!errors[f] || undefined}
          onChange={(e) => set(f, e.target.value)}
        />
      </Row>
    ) : null;
  const toggle = (f: 'guest' | 'advanced', label: WordKey) =>
    shown.has(f) ? (
      <Row key={f} id={fieldId(f)} label={t(label)}>
        <Switch id={fieldId(f)} aria-label={t(label)} className="justify-self-start" isSelected={form[f]} onChange={(on) => set(f, on)} />
      </Row>
    ) : null;

  async function save() {
    setChecked(true);
    if (Object.keys(found).length) return;
    if (form.kind === 'rclone') {
      const own = form.advanced;
      const advanced = {
        site: form.cloud === 'sharepoint' ? form.site.trim() : '',
        clientId: own ? form.clientId.trim() : '',
        clientSecret: own ? form.clientSecret : '',
        tenant: own && MICROSOFT.includes(form.cloud) ? form.tenant.trim() : '',
      };
      close();
      void signIn(form.cloud, form.cloudName.trim(), advanced);
      return;
    }
    try {
      const d = await api.remote.save({ connection: described(form, editing?.id ?? ''), secret: form.secret || null });
      if (!d.kept) toast(t('secretNotKept'));
      close();
      await load();
      void openConnection(byId(d.connection.id) ?? { ...d.connection, live: false });
    } catch (e) {
      setNote({ text: errorText(e), good: false });
    }
  }

  async function test() {
    setChecked(true);
    if (Object.keys(found).length) return;
    const connection = described(form, editing?.id ?? '');
    setNote(null);
    setTrying(true);
    try {
      for (let tries = 0; tries < 3; tries++) {
        try {
          await api.remote.test({ connection, secret: form.secret || null });
          setNote({ text: t('connectionWorks'), good: true });
          return;
        } catch (e) {
          const error = messageOf(e);
          // The question is a sheet over this one; a server trusted is tried again.
          if (error.startsWith(TRUST) && (await ask({ id: connection.id ?? '', name: connection.name ?? '', host: connection.host ?? '', port: connection.port ?? null }, error))) continue;
          setNote({ text: errorText(error), good: false });
          return;
        }
      }
    } finally {
      setTrying(false);
    }
  }

  const enter = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      e.preventDefault();
      void save();
    }
  };

  const notes: WordKey[] = rclone ? ['rcloneNote', ...(form.cloud === 'onedrive_work' || form.cloud === 'sharepoint' ? (['workNote'] as const) : []), ...(form.advanced ? (['advancedNote'] as const) : [])] : [];

  return (
    <SheetFrame
      open
      onClose={close}
      title={t(editing ? 'editServer' : 'connectServer')}
      footer={
        <>
          {mounted || rclone ? null : (
            <Button className="sm:mr-auto" isDisabled={trying} onPress={() => void test()}>
              {t('tryConnect')}
            </Button>
          )}
          <Button onPress={close}>{t('cancel')}</Button>
          <Button variant="default" onPress={() => void save()}>
            {t(rclone ? 'signIn' : 'saveConnect')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5 py-1" onKeyDown={enter}>
        <Row id={`${base}-kind`} label={t('serverKind')}>
          <Select
            id={`${base}-kind`}
            aria-label={t('serverKind')}
            className="w-full"
            selectedKey={kind}
            isDisabled={!!editing}
            autoFocus={!editing}
            onSelectionChange={(key) => {
              const next = KINDS.find(([k]) => k === key)?.[0];
              if (next) setForm((f) => ({ ...f, kind: next }));
              setNote(null);
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="p-1">
              {KINDS.map(([k, label]) => (
                <SelectItem key={k} id={k}>
                  {t(label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        {shown.has('cloud') ? (
          <Row id={fieldId('cloud')} label={t('cloudKind')}>
            <Select
              id={fieldId('cloud')}
              aria-label={t('cloudKind')}
              className="w-full"
              selectedKey={form.cloud}
              onSelectionChange={(key) => {
                if (typeof key === 'string' && isCloudKind(key)) set('cloud', key);
              }}
            >
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="p-1">
                {(Object.keys(CLOUDS) as CloudKind[]).map((k) => (
                  <SelectItem key={k} id={k}>
                    {t(CLOUDS[k])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        ) : null}
        {text('cloudName', 'cloudName', { placeholder: t('phCloudName') })}
        {text('site', 'cloudSite', { placeholder: t('siteHint') })}
        {text('name', 'serverName', { autoFocus: !!editing })}
        {text('host', 'serverHost', { placeholder: t('phHost') })}
        {text('port', 'serverPort', { placeholder: PORTS[kind] ? String(PORTS[kind]) : undefined })}
        {text('endpoint', 'serverEndpoint', { placeholder: t('phEndpoint') })}
        {text('region', 'serverRegion', { placeholder: kind === 'oss' ? t('phRegionOss') : t('phRegion', t('optional')) })}
        {text('user', s3 ? 'serverAccessKey' : 'serverUser')}
        {text('secret', s3 ? 'serverSecretKey' : kind === 'sftp' ? 'serverPassphrase' : 'serverPassword', { secret: true, placeholder: editing ? t('keepSecret') : undefined })}
        {text('keyFile', 'serverKeyFile', { placeholder: t('phKeyFile') })}
        {text('path', share ? 'serverShare' : mounted ? 'serverPath' : 'serverFolder', { placeholder: share ? t('phShare') : mounted ? t('phRoot') : t('phPath', t('optional')) })}
        {text('bucket', 'serverBucket', { placeholder: t('optional') })}
        {toggle('guest', 'serverGuest')}
        {toggle('advanced', 'cloudAdvanced')}
        {text('clientId', 'clientId')}
        {text('clientSecret', 'clientSecret', { secret: true })}
        {text('tenant', 'tenantId', { placeholder: t('phTenant') })}
        {notes.length ? (
          <div className="mt-1 flex flex-col gap-1.5 text-[12px] leading-relaxed text-fg-2">
            {notes.map((n) => (
              <p key={n}>{t(n)}</p>
            ))}
          </div>
        ) : null}
        <p role="status" aria-live="polite" className={cn('flex items-center gap-1.5 text-[12px] empty:hidden leading-snug break-words whitespace-pre-wrap', note?.good ? 'text-good' : 'text-bad')}>
          {trying ? (
            <>
              <Spinner aria-hidden="true" className="size-3.5 text-fg-2" />
              <span className="text-fg-2">{t('tryingConnect')}</span>
            </>
          ) : (
            note?.text
          )}
        </p>
      </div>
    </SheetFrame>
  );
}
