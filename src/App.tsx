import { useEffect } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { DialogHost, SheetHost } from '@/features/dialogs';
import { JobsPanel } from '@/features/jobs';
import { useKeys } from '@/features/keys';
import { PaneGrid } from '@/features/panes';
import { PreviewSlot } from '@/features/preview';
import { Sidebar } from '@/features/sidebar';
import { Toolbar } from '@/features/toolbar';
import { UpdateBanner } from '@/features/update';
import { useApp, connectApp } from '@/lib/app-state';
import { openSheet, useRegistry } from '@/lib/registry';
import { api, getHost } from '@/services';

/** A press on the toolbar or the top of the sidebar moves the window, and a double click zooms it, as its title bar would. */
function useWindowDrag(): void {
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (e.button !== 0 || !target?.closest('[data-drag]') || target.closest('button, input, label, a, select, [data-nodrag]')) return;
      void (e.detail === 2 ? api.app.zoom() : api.app.drag()).catch(() => undefined);
    };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, []);
}

/** Outside the app only, `?sheet=<id>` opens that sheet once the window is ready, so a sheet can be photographed. */
function useOpenSheetFromUrl(ready: boolean): void {
  useEffect(() => {
    if (!ready || getHost().native) return;
    const id = new URLSearchParams(window.location.search).get('sheet');
    if (id) openSheet(id);
  }, [ready]);
}

export function App() {
  const ready = useApp((s) => !!s.settings && !!s.places);
  const role = useApp((s) => s.role);
  const RoleView = useRegistry((s) => s.roles[role]);
  useWindowDrag();
  useKeys();
  useEffect(() => {
    connectApp();
  }, []);
  useOpenSheetFromUrl(ready);

  return (
    <>
      {ready ? RoleView ? <RoleView /> : <FileManager /> : null}
      <SheetHost />
      <DialogHost />
      <JobsPanel />
      <UpdateBanner />
      <Toaster position="bottom-right" />
    </>
  );
}

/** The window of the file manager: the sidebar on the left, and on the right the toolbar over the panes and the preview. */
function FileManager() {
  return (
    <div className="flex h-full gap-2 p-2">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col gap-2">
        <Toolbar />
        <div className="flex min-h-0 flex-1 gap-2 has-[>[data-preview=bottom]]:flex-col">
          <PaneGrid />
          <PreviewSlot />
        </div>
      </main>
    </div>
  );
}
