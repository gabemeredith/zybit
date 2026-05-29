"use client";

import { useEffect } from "react";
import { usePostHog } from "posthog-js/react";

interface Props {
  userId: string;
  orgId: string;
  email: string;
  role: string;
}

export function PostHogIdentify({ userId, orgId, email, role }: Props) {
  const ph = usePostHog();

  useEffect(() => {
    if (ph) {
      ph.identify(userId, {
        email,
        organization_id: orgId,
        role,
      });
    }
  }, [userId, orgId, email, role, ph]);

  return null;
}
