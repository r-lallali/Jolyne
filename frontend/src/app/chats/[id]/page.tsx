"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { use } from "react";
import { FriendConversation } from "@/components/friends/FriendConversation";

export default function FriendChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { id: idStr } = use(params);
  const id = Number(idStr);
  return (
    <motion.main
      className="h-dvh w-full"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      <FriendConversation
        friendId={id}
        onBack={() => router.push("/chats")}
        onLeft={() => router.push("/chats")}
      />
    </motion.main>
  );
}
