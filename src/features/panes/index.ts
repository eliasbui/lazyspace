// The panes, the heart of the window. Loading this module installs them behind `panes` (src/lib/panes-api.ts) and starts
// listening to the host; `PaneGrid` draws them and starts them once the app has said hello.
import { installPanes } from '@/lib/panes-api';
import { manager } from './manager';

installPanes(manager);
manager.listen();

export { PaneGrid } from './PaneGrid';
