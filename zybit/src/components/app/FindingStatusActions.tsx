"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateFindingStatusAction } from "@/app/app/findings/actions";

type Status = "open" | "approved" | "dismissed" | "shipped" | "measured";

interface FindingStatusActionsProps {
  findingId: string;
  currentStatus: Status;
}

const ACTIONS: Array<{
  targetStatus: Status;
  label: string;
  style: string;
  fromStatuses: Status[];
}> = [
  {
    targetStatus: "approved",
    label: "Approve",
    style: "bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700",
    fromStatuses: ["open"],
  },
  {
    targetStatus: "dismissed",
    label: "Dismiss",
    style: "bg-white border-[#111] text-[#111] hover:bg-[#111] hover:text-[#FAFAF8]",
    fromStatuses: ["open", "approved"],
  },
  {
    targetStatus: "open",
    label: "Re-open",
    style: "bg-white border-[#111] text-[#111] hover:bg-[#111] hover:text-[#FAFAF8]",
    fromStatuses: ["dismissed", "approved"],
  },
  {
    targetStatus: "shipped",
    label: "Mark shipped",
    style: "bg-sky-600 border-sky-600 text-white hover:bg-sky-700",
    fromStatuses: ["approved"],
  },
];

export default function FindingStatusActions({
  findingId,
  currentStatus,
}: FindingStatusActionsProps) {
  const [loading, setLoading] = useState<Status | null>(null);
  const router = useRouter();

  const available = ACTIONS.filter((a) => a.fromStatuses.includes(currentStatus));

  if (available.length === 0) return null;

  async function handleAction(targetStatus: Status) {
    setLoading(targetStatus);
    try {
      await updateFindingStatusAction(findingId, targetStatus);
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {available.map((action) => (
        <button
          key={action.targetStatus}
          type="button"
          onClick={() => handleAction(action.targetStatus)}
          disabled={loading !== null}
          className={`px-4 py-2 mono-text text-xs font-bold uppercase tracking-[0.08em] border-[1.5px] transition-all disabled:opacity-40 ${action.style}`}
        >
          {loading === action.targetStatus ? "…" : action.label}
        </button>
      ))}
    </div>
  );
}
