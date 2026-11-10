import type { Entry } from '../protocol';
import { type MockFs, type Virtual, extOf, fileUri, joinPath } from './fs';
import { random } from './util';

// The files of the mock: a home folder with the usual folders, an Applications folder, a backup disk, and a folder of
// a hundred thousand items that is never stored.

const DAY = 86_400;
const MB = 1_048_576;

export const BIG_COUNT = 100_000;
const BIG_FOLDERS = 40;
const BIG_EXTS = ['txt', 'jpg', 'pdf', 'md', 'png', 'zip', 'csv', 'mov'];

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/** `/Users/demo/Big`: items by index, `Album 0001` first, then `Item 000001.txt` and so on, in name order. */
export function bigFolder(dir: string, now: number): Virtual {
  const at = (i: number): Entry => {
    const isDir = i < BIG_FOLDERS;
    const name = isDir ? `Album ${pad(i + 1, 4)}` : `Item ${pad(i - BIG_FOLDERS + 1, 6)}.${BIG_EXTS[i % BIG_EXTS.length]}`;
    const ext = isDir ? '' : extOf(name);
    const mtime = now - i * 37;
    return {
      name,
      uri: fileUri(joinPath(dir, name)),
      kind: isDir ? 'dir' : 'file',
      isDir,
      size: isDir ? 0 : ((i * 7919) % 4_000_000) + 1000,
      mtime,
      ctime: mtime - 3600,
      hidden: false,
      ext,
      icon: isDir ? 'type:public.folder' : `ext:${ext}`,
    };
  };
  const indexOf = (name: string): number | null => {
    const album = /^Album (\d{4})$/.exec(name);
    if (album) {
      const n = Number(album[1]);
      return n >= 1 && n <= BIG_FOLDERS ? n - 1 : null;
    }
    const item = /^Item (\d{6})\.([a-z]+)$/.exec(name);
    if (!item) return null;
    const i = BIG_FOLDERS + Number(item[1]) - 1;
    return i >= BIG_FOLDERS && i < BIG_COUNT && at(i).name === name ? i : null;
  };
  return { count: BIG_COUNT, folders: BIG_FOLDERS, at, indexOf };
}

const SIZES: Record<string, [number, number]> = {
  jpg: [1.2 * MB, 6 * MB],
  png: [0.3 * MB, 3 * MB],
  heic: [1 * MB, 4 * MB],
  pdf: [0.2 * MB, 5 * MB],
  mp3: [3 * MB, 11 * MB],
  mp4: [40 * MB, 900 * MB],
  mov: [60 * MB, 1200 * MB],
  zip: [1 * MB, 300 * MB],
  dmg: [30 * MB, 700 * MB],
  xlsx: [0.02 * MB, 1 * MB],
  docx: [0.02 * MB, 2 * MB],
  key: [2 * MB, 40 * MB],
  txt: [0.001 * MB, 0.05 * MB],
  md: [0.001 * MB, 0.03 * MB],
};

export function seedFiles(fs: MockFs, now: number): void {
  const rnd = random(20261110);
  const between = (lo: number, hi: number): number => Math.floor(lo + rnd() * (hi - lo));
  const make = (dir: string, name: string, maxAgeDays = 120, text?: string): void => {
    const [lo, hi] = SIZES[extOf(name)] ?? [0.01 * MB, 0.5 * MB];
    fs.file(dir, name, between(lo, hi), now - between(0, maxAgeDays * DAY), text);
  };
  const folder = (dir: string, name: string, ageDays = 30): string => {
    fs.mkdir(dir, name, now - between(0, ageDays * DAY));
    return joinPath(dir, name);
  };
  const bundle = (dir: string, name: string, kind: 'app' | 'package', size: number): void => {
    fs.add(dir, { name, kind, size: 0, mtime: now - between(5 * DAY, 300 * DAY), ctime: now - 400 * DAY, hidden: false, children: new Map(), text: String(size) });
  };

  const home = fs.home;
  for (const top of ['Users', 'Applications', 'Volumes', 'System', 'Library']) folder('/', top, 400);
  fs.ensure(home, now - DAY);

  // Home
  for (const name of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Movies', 'Public']) folder(home, name, 3);
  const library = folder(home, 'Library', 10);
  const trash = folder(home, '.Trash', 2);
  const libraryNode = fs.node(library);
  if (libraryNode) libraryNode.hidden = true;
  make(home, '.zshrc', 300, 'export PATH="$HOME/bin:$PATH"\nalias ll="ls -la"\n');
  make(home, '.gitconfig', 300, '[user]\n\tname = Demo\n\temail = demo@example.com\n');
  folder(home, '.config', 200);
  make(trash, 'old draft.docx', 3);
  make(trash, 'Screenshot 2026-09-14 at 08.01.22.png', 3);

  // Desktop
  const desktop = joinPath(home, 'Desktop');
  for (let i = 0; i < 6; i++) {
    const d = 3 + i;
    make(desktop, `Screenshot 2026-11-0${d} at ${pad(8 + i, 2)}.${pad(10 + i * 7, 2)}.${pad(3 + i * 9, 2)}.png`, 8);
  }
  make(desktop, 'notes.txt', 20, 'Call the bank on Monday.\nBook flights for December.\nBuy a present for Mai.\n');
  make(desktop, 'Boarding pass.pdf', 10);
  make(desktop, 'Budget 2026.xlsx', 30);
  folder(desktop, 'Current Project', 5);
  folder(desktop, 'To sort', 40);

  // Documents
  const documents = joinPath(home, 'Documents');
  const work = folder(documents, 'Work');
  for (let i = 1; i <= 14; i++) make(work, `Report ${i}.pdf`, 200);
  for (const n of ['Q3 review.docx', 'Roadmap.key', 'Contract draft.docx', 'Invoice template.xlsx', 'Org chart.pdf']) make(work, n, 90);
  make(work, 'Meeting notes.md', 30, '# Meeting notes\n\n- Ship the new sidebar\n- Review the sync sheet\n- Plan the December release\n');
  const taxes = folder(documents, 'Taxes');
  for (const y of [2022, 2023, 2024, 2025]) make(taxes, `Tax return ${y}.pdf`, 900);
  const recipes = folder(documents, 'Recipes');
  for (const n of ['Pho bo.md', 'Banh mi.md', 'Bun cha.md', 'Sourdough.md', 'Pasta carbonara.md']) make(recipes, n, 300, `# ${n.replace('.md', '')}\n\nIngredients and steps.\n`);
  const viet = folder(documents, 'Tài liệu');
  for (const n of ['Hóa đơn tháng 10.pdf', 'Hợp đồng thuê nhà.pdf', 'Bảng lương.xlsx', 'Thư gửi cô Lan.docx']) make(viet, n, 100);
  make(documents, 'Resume.pdf', 60);
  make(documents, 'Passport scan.pdf', 400);
  make(documents, 'Thesis final.docx', 250);
  make(documents, 'Thesis final copy.docx', 250);
  make(documents, 'Archive 2024.zip', 400);
  make(documents, '.DS_Store', 10);

  // Downloads
  const downloads = joinPath(home, 'Downloads');
  for (const n of ['Firefox 142.0.dmg', 'Zoom.pkg', 'photos-export.zip', 'invoice-8841.pdf', 'ubuntu-24.04.iso', 'node-v26.13.0.pkg', 'Slides export.pdf', 'dataset.csv', 'wallpaper-pack.zip', 'Figma.dmg', 'receipt.pdf', 'talk.mp4'])
    make(downloads, n, 45);

  // Pictures
  const pictures = joinPath(home, 'Pictures');
  const vacation = folder(pictures, 'Vacation Da Nang', 90);
  for (let i = 0; i < 36; i++) make(vacation, `IMG_${pad(4010 + i, 4)}.${i % 9 === 0 ? 'heic' : 'jpg'}`, 90);
  const shots = folder(pictures, 'Screenshots', 15);
  for (let i = 0; i < 24; i++) make(shots, `Screenshot 2026-10-${pad(1 + (i % 28), 2)} at ${pad(9 + (i % 10), 2)}.${pad(i * 2, 2)}.00.png`, 40);
  const wall = folder(pictures, 'Wallpapers', 200);
  for (const n of ['aurora.jpg', 'dunes.jpg', 'harbour.jpg', 'forest.png']) make(wall, n, 200);
  bundle(pictures, 'Photos Library.photoslibrary', 'package', 8_400 * MB);
  make(pictures, 'logo.png', 100);

  // Music and Movies
  const music = joinPath(home, 'Music');
  for (const album of ['Blue Hour', 'Night Market', 'Rain on Tin']) {
    const a = folder(music, album, 300);
    for (let i = 1; i <= 8; i++) make(a, `${pad(i, 2)} Track ${i}.mp3`, 300);
  }
  const movies = joinPath(home, 'Movies');
  for (const n of ['Family Tet 2026.mov', 'Timelapse.mp4', 'Conference talk.mp4', 'Screen Recording.mov']) make(movies, n, 150);

  // Projects (a git work tree)
  const projects = folder(home, 'Projects', 3);
  const repo = folder(projects, 'lazyspace', 1);
  const git = folder(repo, '.git', 1);
  make(git, 'HEAD', 1, 'ref: refs/heads/main\n');
  const src = folder(repo, 'src', 1);
  for (const n of ['main.tsx', 'App.tsx', 'protocol.ts', 'client.ts']) make(src, n, 3, `// ${n}\n`);
  folder(repo, 'docs', 20);
  make(repo, 'package.json', 2, '{\n  "name": "lazyspace",\n  "version": "0.4.6"\n}\n');
  make(repo, 'README.md', 2, '# LazySpace\n\nA file manager for macOS.\n');
  make(repo, 'notes-todo.txt', 0, 'migrate the sidebar\n');

  // Applications
  const apps = '/Applications';
  for (const n of ['Safari', 'Mail', 'Notes', 'Preview', 'Calendar', 'Messages', 'Visual Studio Code', 'Slack', 'Figma', 'Xcode']) bundle(apps, `${n}.app`, 'app', 300 * MB);
  folder(apps, 'Utilities', 400);
  for (const n of ['Terminal', 'Activity Monitor', 'Disk Utility']) bundle(joinPath(apps, 'Utilities'), `${n}.app`, 'app', 40 * MB);

  // The backup disk
  const backup = '/Volumes/Backup';
  fs.ensure(backup, now - 2 * DAY);
  const tm = folder(backup, 'Backups.backupdb', 2);
  for (const n of ['2026-11-08', '2026-11-09', '2026-11-10']) folder(tm, n, 2);
  folder(backup, 'Photos 2019', 900);
  folder(backup, 'Photos 2020', 800);
  make(backup, 'archive-2021.zip', 900);
  make(backup, 'disk-image.dmg', 700);

  // The big folder
  const big = fs.folder(folder(home, 'Big', 1));
  big.virtual = bigFolder(joinPath(home, 'Big'), now);
  big.children = undefined;

  // Tags, twins and hidden files
  const tag = (path: string, ...tags: Array<[string, number]>): void => {
    const node = fs.node(path);
    if (node) node.tags = tags;
  };
  tag(joinPath(work, 'Q3 review.docx'), ['Red', 6]);
  tag(joinPath(work, 'Roadmap.key'), ['Blue', 4], ['Green', 2]);
  tag(joinPath(documents, 'Resume.pdf'), ['Green', 2]);
  tag(joinPath(desktop, 'Boarding pass.pdf'), ['Orange', 7]);
  tag(joinPath(desktop, 'Current Project'), ['Purple', 3]);
  const twin = (a: string, b: string, digest: string): void => {
    const x = fs.node(a);
    const y = fs.node(b);
    if (x && y) {
      x.digest = y.digest = digest;
      y.size = x.size;
    }
  };
  twin(joinPath(documents, 'Thesis final.docx'), joinPath(documents, 'Thesis final copy.docx'), 'thesis');
  twin(joinPath(downloads, 'receipt.pdf'), joinPath(downloads, 'invoice-8841.pdf'), 'receipt');
}
