import { Button, Card, toast } from "@ob/ui/shadcn";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ApiClientError } from "../api/client";
import type { LinkedApp } from "../api/contract";
import { useLinkedApps, useUnlinkApp } from "../api/queries";
import { isSignedIn } from "../api/queryClient";
import { day, messageOf } from "../format";
import { PageHeader } from "../layout/PageHeader";
import { useDocumentTitle } from "../layout/useDocumentTitle";
import { EmptyCard } from "../ui/EmptyCard";
import { LoadError } from "../ui/LoadError";
import { focusApp } from "./focus";
import { UnlinkDialog } from "./UnlinkDialog";

/** Settings: the apps linked to this owner, each unlinkable. */
export function Settings() {
  useDocumentTitle("Settings");
  const apps = useLinkedApps();
  const unlink = useUnlinkApp();
  const qc = useQueryClient();
  const [target, setTarget] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Where focus returns on close: the row (a cancel), else the next row,
  // else the previous. Set when the dialog opens.
  const returnTo = useRef<string[]>([]);

  const confirm = () => {
    const aud = target;
    setOpen(false);
    if (!aud) return;
    // Its row goes at once (optimistic), so focus skips it.
    returnTo.current = returnTo.current.filter((a) => a !== aud);
    unlink.mutateAsync(aud).then(
      () => {
        if (!isSignedIn(qc)) return;
        toast.success(
          <>
            Unlinked <bdi className="font-mono">{aud}</bdi>.
          </>,
          { duration: 8000 },
        );
      },
      (e: unknown) => {
        if (!isSignedIn(qc)) return;
        if (e instanceof ApiClientError && e.code === "unauthorized") return;
        toast.error(`Couldn't unlink ${aud}`, {
          description: messageOf(e),
          duration: 8000,
        });
      },
    );
  };

  const unavailable = apps.data === null;
  const list = apps.data?.apps;
  return (
    <>
      <PageHeader title="Settings" />
      <section aria-labelledby="linked-apps" className="flex flex-col gap-4">
        <h2 id="linked-apps" className="text-base font-semibold">
          Linked apps
        </h2>
        {list && list.length > 0 && (
          <Card className="gap-0 overflow-hidden rounded-lg py-0 shadow-none">
            <ul className="divide-y">
              {list.map((a, i) => (
                <AppRow
                  key={a.aud}
                  app={a}
                  onUnlink={() => {
                    returnTo.current = [
                      a.aud,
                      list[i + 1]?.aud,
                      list[i - 1]?.aud,
                    ].filter((x) => x !== undefined);
                    setTarget(a.aud);
                    setOpen(true);
                  }}
                />
              ))}
            </ul>
          </Card>
        )}
        {list?.length === 0 && (
          <EmptyCard
            title="No linked apps"
            help="Link one from the app's settings."
          />
        )}
        {unavailable && (
          <p className="text-sm text-muted-foreground">
            Linked apps aren't available on this bus yet.
          </p>
        )}
        {!unavailable && !list && !apps.error && (
          <p className="text-sm text-muted-foreground">Loading linked apps</p>
        )}
        {apps.error && !list && (
          <LoadError
            title="Couldn't load linked apps"
            error={apps.error}
            fetching={apps.isFetching}
            onRetry={() => void apps.refetch()}
          />
        )}
      </section>
      <UnlinkDialog
        open={open}
        aud={target}
        onConfirm={confirm}
        onClose={() => setOpen(false)}
        onCloseAutoFocus={() => focusApp(returnTo.current)}
      />
    </>
  );
}

function AppRow({ app, onUnlink }: { app: LinkedApp; onUnlink(): void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="font-mono text-sm [overflow-wrap:anywhere]">
          {app.aud}
        </div>
        <div className="text-xs text-muted-foreground">
          Linked {day(app.linkedAt)}
        </div>
      </div>
      <Button
        variant="destructive"
        size="sm"
        aria-label={`Unlink ${app.aud}`}
        data-aud={app.aud}
        className="h-7 rounded-full border border-transparent bg-(--ob-danger-soft) px-3 text-(--ob-danger) hover:border-(--ob-danger) hover:bg-(--ob-danger-soft)"
        onClick={onUnlink}
      >
        Unlink
      </Button>
    </li>
  );
}
