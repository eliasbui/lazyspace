// The pages of Settings the window has of its own (the old page's index.html): General, Appearance and About.
import { useContext } from 'react';
import { CircleHalfIcon, MoonIcon, SunIcon } from '@phosphor-icons/react';
import { Pill } from '@/components/macos/Glass';
import { Group, Row, SettingsQuery } from '@/components/macos/Settings';
import { Segmented } from '@/components/macos/Segmented';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { useT, type WordKey } from '@/i18n';
import { setSetting, useApp, useSettings } from '@/lib/app-state';
import { fold } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Language, Settings, SettingsPatch, ThemeChoice } from '@/services';
import { busy, updateButton, updateNote, updateStep, useUpdate } from './update';

/** A row with a switch that sets one setting. */
function Toggle({ label, hint, on, patch }: { label: WordKey; hint: WordKey; on: boolean; patch: (on: boolean) => SettingsPatch }) {
  const t = useT();
  return (
    <Row label={t(label)} hint={t(hint)}>
      <Switch aria-label={t(label)} isSelected={on} onChange={(value) => void setSetting(patch(value))} />
    </Row>
  );
}

export function GeneralSection() {
  const t = useT();
  const s = useSettings();
  if (!s) return null;
  return (
    <div className="flex flex-col gap-5">
      <Group>
        <Row label={t('language')} hint={t('languageHint')}>
          <NativeSelect size="sm" aria-label={t('language')} className="w-36" value={s.language} onChange={(e) => void setSetting({ language: e.target.value === 'en' ? 'en' : 'vi' })}>
            {(['vi', 'en'] as const satisfies readonly Language[]).map((lang) => (
              <NativeSelectOption key={lang} value={lang}>
                {t(lang === 'vi' ? 'langVi' : 'langEn')}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Row>
      </Group>
      <Group>
        <Toggle label="foldersFirst" hint="foldersFirstHint" on={s.sort.foldersFirst} patch={(on) => ({ sort: { foldersFirst: on } })} />
        <Toggle label="folderSizes" hint="folderSizesHint" on={s.folder_sizes} patch={(on) => ({ folder_sizes: on })} />
        <Toggle label="alwaysTabs" hint="alwaysTabsHint" on={s.always_tabs} patch={(on) => ({ always_tabs: on })} />
      </Group>
      <Group>
        <Toggle label="copyQueue" hint="copyQueueHint" on={s.copy_queue} patch={(on) => ({ copy_queue: on })} />
        <Toggle label="verifyCopies" hint="verifyCopiesHint" on={s.verify_copies} patch={(on) => ({ verify_copies: on })} />
      </Group>
      <Group>
        <Toggle label="notifyDevices" hint="notifyDevicesHint" on={s.notify_devices} patch={(on) => ({ notify_devices: on })} />
        <Toggle label="background" hint="backgroundHint" on={s.background} patch={(on) => ({ background: on })} />
      </Group>
    </div>
  );
}

const THEMES: Array<[ThemeChoice, WordKey, typeof SunIcon]> = [
  ['system', 'system', CircleHalfIcon],
  ['light', 'light', SunIcon],
  ['dark', 'dark', MoonIcon],
];

export function ThemeSection() {
  const t = useT();
  const s = useSettings();
  if (!s) return null;
  return (
    <Group>
      <Row label={t('theme')} hint={t('themeHint')}>
        <Segmented<Settings['theme']>
          label={t('theme')}
          value={s.theme}
          options={THEMES.map(([value, word, Icon]) => ({ value, label: t(word), icon: <Icon className="size-3.5" /> }))}
          onChange={(theme) => void setSetting({ theme })}
        />
      </Row>
      <Row
        label={
          <span className="flex items-center gap-1.5">
            {t('liquidGlass')}
            <Pill tone="tint">{t('beta')}</Pill>
          </span>
        }
        keywords={t('liquidGlass')}
        hint={t('glassHint')}
      >
        <Switch aria-label={t('liquidGlass')} isSelected={s.glass} onChange={(glass) => void setSetting({ glass })} />
      </Row>
    </Group>
  );
}

/** The version, how the update stands with its one button, the notes of a new version, and the automatic check. */
export function AboutSection() {
  const t = useT();
  const s = useSettings();
  const version = useApp((a) => a.version);
  const u = useUpdate();
  const query = useContext(SettingsQuery);
  if (!s) return null;
  const note = updateNote(u);
  const shown = !query || fold(`${t('appName')} ${t('checkUpdate')} ${note}`).includes(query);
  const notes = u.stage === 'available' ? u.notes.trim() : '';
  return (
    <Group>
      {shown ? (
        <div data-slot="settings-row" className="flex flex-col gap-3 px-4 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[13px] font-semibold">
                {t('appName')} <span className="font-normal text-fg-2 tabular-nums">{version || '-'}</span>
              </span>
              {note ? <span className={cn('text-[12px] leading-snug text-fg-2 select-text', u.stage === 'error' && 'text-bad')}>{note}</span> : null}
            </div>
            <Button variant={u.stage === 'available' || u.stage === 'ready' ? 'default' : 'outline'} isDisabled={busy(u)} onPress={updateStep}>
              {t(updateButton(u))}
            </Button>
          </div>
          {u.stage === 'downloading' ? <Progress aria-label={t('updating')} value={u.percent} /> : null}
          {notes ? <pre className="max-h-40 overflow-auto rounded-field bg-field px-3 py-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg-2 select-text">{notes}</pre> : null}
        </div>
      ) : null}
      <Toggle label="autoUpdate" hint="autoUpdateHint" on={s.check_updates} patch={(on) => ({ check_updates: on })} />
    </Group>
  );
}
