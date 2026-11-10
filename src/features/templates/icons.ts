import type { Icon } from '@phosphor-icons/react';
import { BracketsCurlyIcon, FileCodeIcon, FileDocIcon, FileIcon, FileMdIcon, FileTextIcon, FileXlsIcon, GlobeIcon, TerminalIcon } from '@phosphor-icons/react';

/** The SF Symbol of a template in the native menu, by its extension. */
export const SYMBOL: Record<string, string> = {
  txt: 'doc.text',
  md: 'doc.plaintext',
  docx: 'doc.richtext',
  xlsx: 'tablecells',
  sh: 'terminal',
  py: 'chevron.left.forwardslash.chevron.right',
  html: 'globe',
  json: 'curlybraces',
};

/** The same, as the sheet draws it. */
export const ICON: Record<string, Icon> = {
  txt: FileTextIcon,
  md: FileMdIcon,
  docx: FileDocIcon,
  xlsx: FileXlsIcon,
  sh: TerminalIcon,
  py: FileCodeIcon,
  html: GlobeIcon,
  json: BracketsCurlyIcon,
};

export const templateIcon = (ext: string): Icon => ICON[ext] ?? FileIcon;
