"use client";

import { useEffect } from "react";
import { track } from "@/lib/track";

// Émet un page_view au montage (haut du funnel : visiteurs). Composant vide —
// à inclure dans les pages publiques dont on veut mesurer l'audience.
export default function TrackPageView() {
  useEffect(() => {
    void track("page_view");
  }, []);
  return null;
}
