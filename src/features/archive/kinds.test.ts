import { describe, expect, it } from 'vitest';
import type { Row } from '@/services';
import { inArchive, isArchive, offeredName } from './kinds';

const row = (name: string, uri = `file:///Users/demo/${name}`, kind: Row['kind'] = 'file'): Row => ({ name, uri, kind, isDir: kind === 'dir', size: 1, mtime: 0, ctime: 0, hidden: false, ext: '', icon: '', type: '' });

describe('archive kinds', () => {
  it('opens archive files of this Mac as folders, and nothing else', () => {
    expect(isArchive(row('a.zip'))).toBe(true);
    expect(isArchive(row('Photos.TAR.GZ'))).toBe(true);
    expect(isArchive(row('a.zip', 'sftp://nas/a.zip'))).toBe(false);
    expect(isArchive(row('a.zip', undefined, 'dir'))).toBe(false);
    expect(isArchive(row('notes.txt'))).toBe(false);
    expect(isArchive(null)).toBe(false);
  });

  it('knows a place inside an archive', () => {
    expect(inArchive('archive:///Users/demo/a.zip!/x')).toBe(true);
    expect(inArchive('file:///Users/demo')).toBe(false);
  });

  it('offers the name without its extension', () => {
    expect(offeredName('Report 1.pdf')).toBe('Report 1');
    expect(offeredName('Current Project')).toBe('Current Project');
    expect(offeredName('.zshrc')).toBe('.zshrc');
  });
});
