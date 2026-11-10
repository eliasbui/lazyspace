import type { CloudFolder, Connection, OpenInTool, Phone, Settings, Template, UserAction, Volume } from '../protocol';
import { fileUri } from './fs';
import { tr } from './util';

// Lists that do not live in the fake file system: settings, disks, tools, templates, servers.

export const VERSION = '0.4.6';

export function defaultSettings(): Settings {
  return {
    language: 'vi',
    theme: 'system',
    glass: false,
    keymap: 'mac',
    show_hidden: false,
    folder_sizes: false,
    view_mode: 'list',
    sort: { by: 'name', desc: false, foldersFirst: true, group: '' },
    confirm_delete: true,
    preview: { side: 'right', on: false },
    desktop: { on: false, hide_finder_icons: false },
    accent: 'system',
    sidebar_icons: 'mono',
    icon_size: 64,
    text_size: 'medium',
    font: '',
    check_updates: true,
    file_viewer: false,
    always_tabs: true,
    columns: ['mtime', 'size', 'kind'],
    copy_queue: false,
    verify_copies: false,
    notify_devices: true,
    background: false,
    favourites: [fileUri('/Users/demo/Documents/Work'), fileUri('/Users/demo/Projects')],
    sidebar_sections: null,
  };
}

export const CHOICES: Array<[key: string, read: (s: Settings) => string, allowed: string[]]> = [
  ['language', (s) => s.language, ['vi', 'en']],
  ['accent', (s) => s.accent, ['system', 'blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'graphite']],
  ['sidebar_icons', (s) => s.sidebar_icons, ['mono', 'color']],
  ['text_size', (s) => s.text_size, ['small', 'medium', 'large']],
  ['theme', (s) => s.theme, ['system', 'light', 'dark']],
  ['keymap', (s) => s.keymap, ['mac', 'windows']],
  ['view_mode', (s) => s.view_mode, ['list', 'icons', 'columns', 'gallery']],
  ['sort.by', (s) => s.sort.by, ['name', 'size', 'mtime', 'ctime', 'kind', 'ext', 'where']],
  ['sort.group', (s) => s.sort.group, ['', 'kind', 'date', 'size']],
  ['preview.side', (s) => s.preview.side, ['right', 'bottom']],
];

export const VOLUMES: Volume[] = [
  { name: 'Macintosh HD', path: '/', ejectable: false, internal: true, total: 494_384_795_648, free: 213_410_000_000 },
  { name: 'Backup', path: '/Volumes/Backup', ejectable: true, internal: false, total: 1_000_204_886_016, free: 641_900_000_000 },
];

export const FONTS = ['Arial', 'Avenir Next', 'Baskerville', 'Futura', 'Georgia', 'Helvetica Neue', 'Menlo', 'Optima', 'SF Pro', 'Times New Roman', 'Verdana'];

export function openInTools(): OpenInTool[] {
  const tool = (id: string, name: string, kind: 'terminal' | 'editor', path: string, isDefault = false): OpenInTool => ({ id, name, kind, path, default: isDefault });
  return [
    tool('terminal', 'Terminal', 'terminal', '/System/Applications/Utilities/Terminal.app', true),
    tool('ghostty', 'Ghostty', 'terminal', '/Applications/Ghostty.app'),
    tool('vscode', 'Visual Studio Code', 'editor', '/Applications/Visual Studio Code.app', true),
    tool('zed', 'Zed', 'editor', '/Applications/Zed.app'),
    tool('textedit', 'TextEdit', 'editor', '/System/Applications/TextEdit.app'),
  ];
}

export interface BuiltinTemplate extends Template {
  text: string;
}

export function builtinTemplates(): BuiltinTemplate[] {
  const make = (id: string, vi: string, en: string, ext: string, text: string): BuiltinTemplate => ({ id, name: tr(vi, en), ext, builtin: true, text });
  return [
    make('txt', 'Tài liệu văn bản', 'Text Document', 'txt', ''),
    make('md', 'Tài liệu Markdown', 'Markdown Document', 'md', '# \n'),
    make('docx', 'Tài liệu Word', 'Word Document', 'docx', ''),
    make('xlsx', 'Bảng tính Excel', 'Excel Spreadsheet', 'xlsx', ''),
    make('sh', 'Shell script', 'Shell Script', 'sh', '#!/bin/sh\n\n'),
    make('py', 'Python script', 'Python Script', 'py', '#!/usr/bin/env python3\n\n'),
    make('html', 'Trang HTML', 'HTML Page', 'html', '<!doctype html>\n<html>\n</html>\n'),
    make('json', 'Tệp JSON', 'JSON File', 'json', '{}\n'),
  ];
}

export function userActions(): UserAction[] {
  return [
    { id: 'a1', name: 'Count lines', command: 'wc -l "$@"', when: 'files', output: 'toast' },
    { id: 'a2', name: 'Open in Terminal', command: 'ls -la', when: 'none', output: 'terminal' },
  ];
}

export function initialConnections(): Connection[] {
  const base: Connection = { id: '', name: '', scheme: 'sftp', host: '', port: null, user: '', path: '', region: '', endpoint: '', bucket: '', keyFile: '', guest: false };
  return [
    { ...base, id: 'c1a2b3', name: 'Home NAS', scheme: 'sftp', host: 'nas.local', port: 22, user: 'demo', path: '/volume1/share' },
    { ...base, id: 'd4e5f6', name: 'Photos bucket', scheme: 's3', host: '', user: 'AKIADEMO', region: 'ap-southeast-1', bucket: 'demo-photos' },
  ];
}

export function clouds(): CloudFolder[] {
  return [
    { name: 'iCloud Drive', account: null, service: 'icloud', uri: fileUri('/Users/demo/Library/Mobile Documents/com~apple~CloudDocs') },
    { name: 'Dropbox', account: 'demo@example.com', service: 'dropbox', uri: fileUri('/Users/demo/Library/CloudStorage/Dropbox') },
  ];
}

export function phones(): Phone[] {
  return [{ key: 'usb-14100000', name: 'Demo iPhone', kind: 'apple', uri: 'device://usb-14100000/', readable: true, state: 'ready', percent: 100 }];
}
