// A user's own Uploads, for an Admin (issue #68's AC, restyled for
// #209): read-only, plus Remove with a required reason through the
// shared RemoveDialog.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioLines, FileVideo, Image as ImageIcon } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AdminPageHeader } from "../components/admin/AdminPageHeader.js";
import { AdminTable, adminHeadCell } from "../components/admin/AdminTable.js";
import { EmptyState } from "../components/admin/EmptyState.js";
import { LoadError } from "../components/admin/LoadError.js";
import { RemoveDialog } from "../components/admin/RemoveDialog.js";
import { Button } from "../components/ui/button.js";
import { Pill } from "../components/ui/pill.js";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.js";
import { api, ok } from "../lib/api.js";
import { formatBytes, formatDuration, formatWhen } from "../lib/format.js";

interface AdminUpload {
  id: string;
  originalName: string;
  size: number;
  status: "uploading" | "complete" | "failed";
  kind: string | null;
  thumbnailKey: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  trimmedFromId: string | null;
  createdAt: string;
  removedAt: string | null;
  removedReason: string | null;
}

function UploadThumb({ upload }: { upload: AdminUpload }) {
  if (upload.thumbnailKey && !upload.removedAt) {
    return (
      <img
        src={`/api/uploads/${upload.id}/thumb`}
        alt=""
        className="size-10 rounded-md bg-muted object-cover"
      />
    );
  }
  const Icon =
    upload.kind === "video"
      ? FileVideo
      : upload.kind === "audio"
        ? AudioLines
        : ImageIcon;
  return (
    <span className="flex size-10 items-center justify-center rounded-md bg-muted">
      <Icon className="size-4" />
    </span>
  );
}

function uploadFacts(upload: AdminUpload): string {
  const parts: string[] = [];
  if (upload.width && upload.height) {
    parts.push(`${upload.width}×${upload.height}`);
  }
  if (upload.durationMs) parts.push(formatDuration(upload.durationMs));
  if (upload.trimmedFromId) parts.push("trimmed");
  return parts.join(" · ") || "—";
}

function UploadStatusPill({ upload }: { upload: AdminUpload }) {
  if (upload.removedAt) {
    return (
      <div className="flex flex-col gap-0.5">
        <Pill tone="err">Removed</Pill>
        <span className="text-[12.5px] text-muted-foreground">
          {upload.removedReason}
        </span>
      </div>
    );
  }
  if (upload.status === "uploading")
    return <Pill tone="neutral">Uploading</Pill>;
  if (upload.status === "failed") return <Pill tone="err">Failed</Pill>;
  return <Pill tone="ok">Complete</Pill>;
}

/** `/admin/users/:id/uploads` (issue #68, restyled for #209). */
export function AdminUploadsPage() {
  const { id: userId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const queryKey = ["admin", "uploads", userId];

  const { data: user } = useQuery({
    queryKey: ["admin", "user", userId],
    enabled: !!userId,
    queryFn: () =>
      ok<{ name: string }>(
        api.api.admin.users[":id"].$get({ param: { id: userId as string } }),
      ),
  });

  const { data, error, refetch } = useQuery({
    queryKey,
    enabled: !!userId,
    queryFn: () =>
      ok<{ uploads: AdminUpload[] }>(
        api.api.admin.uploads.$get({ query: { user: userId as string } }),
      ),
  });

  const removeMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      ok<{ upload: AdminUpload }>(
        api.api.admin.uploads[":id"].remove.$post({
          param: { id },
          json: { reason },
        }),
      ),
    onSuccess: (body) => {
      queryClient.setQueryData<{ uploads: AdminUpload[] }>(
        queryKey,
        (current) => ({
          uploads: (current?.uploads ?? []).map((upload) =>
            upload.id === body.upload.id ? body.upload : upload,
          ),
        }),
      );
      setRemovingId(null);
    },
  });

  const uploads = data?.uploads ?? null;

  return (
    <div className="flex flex-col gap-sections">
      <AdminPageHeader
        crumb={
          <>
            <Link
              to="/admin/users"
              className="underline-offset-4 hover:underline"
            >
              Admin / Users
            </Link>
            {" / "}
            <Link
              to={`/admin/users/${userId}`}
              className="underline-offset-4 hover:underline"
            >
              {user?.name ?? userId}
            </Link>
          </>
        }
        title="Uploads"
        description="Read-only. Removing an Upload deletes its file."
      />

      {error && (
        <LoadError
          message="could not load Uploads"
          onRetry={() => void refetch()}
        />
      )}

      {!uploads && !error && <p>Loading…</p>}

      {uploads &&
        (uploads.length === 0 ? (
          <EmptyState>This user has no Uploads.</EmptyState>
        ) : (
          <AdminTable>
            <TableHeader>
              <TableRow>
                <TableHead className={adminHeadCell}>
                  <span className="sr-only">Thumbnail</span>
                </TableHead>
                <TableHead className={adminHeadCell}>Name</TableHead>
                <TableHead className={adminHeadCell}>Kind</TableHead>
                <TableHead className={adminHeadCell}>Size</TableHead>
                <TableHead className={adminHeadCell}>Facts</TableHead>
                <TableHead className={adminHeadCell}>Uploaded</TableHead>
                <TableHead className={adminHeadCell}>Status</TableHead>
                <TableHead className={adminHeadCell}>
                  <span className="sr-only">Remove</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {uploads.map((upload) => (
                <TableRow key={upload.id}>
                  <TableCell>
                    <UploadThumb upload={upload} />
                  </TableCell>
                  <TableCell>
                    {upload.status === "complete" && !upload.removedAt ? (
                      <a
                        href={`/api/uploads/${upload.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {upload.originalName}
                      </a>
                    ) : (
                      upload.originalName
                    )}
                  </TableCell>
                  <TableCell>
                    <Pill>{upload.kind ?? "—"}</Pill>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatBytes(upload.size)}
                  </TableCell>
                  <TableCell>{uploadFacts(upload)}</TableCell>
                  <TableCell>{formatWhen(upload.createdAt)}</TableCell>
                  <TableCell>
                    <UploadStatusPill upload={upload} />
                  </TableCell>
                  <TableCell>
                    {!upload.removedAt && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setRemovingId(upload.id)}
                      >
                        Remove…
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </AdminTable>
        ))}

      <RemoveDialog
        kind="Upload"
        open={!!removingId}
        onOpenChange={(open) => {
          if (!open) setRemovingId(null);
        }}
        onRemove={async (reason) => {
          if (!removingId) return;
          await removeMutation.mutateAsync({ id: removingId, reason });
        }}
      />
    </div>
  );
}
