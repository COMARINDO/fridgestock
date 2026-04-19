import { Suspense } from "react";
import { AdminNav, AdminNavSuspenseFallback } from "@/app/admin/_components/AdminNav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-row">
      <Suspense fallback={<AdminNavSuspenseFallback />}>
        <AdminNav />
      </Suspense>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
