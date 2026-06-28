import Link from "next/link";

// 알 수 없는 배포 / 잘못된 주소 → 친절한 404. (notFound() 호출 시 렌더된다)
export default function NotFound() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-24 text-center">
      <p className="text-sm font-semibold text-muted-foreground">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Deployment not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        It may have been deleted, or the URL is incorrect.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block text-sm text-foreground underline underline-offset-4"
      >
        ← Back to deployments
      </Link>
    </div>
  );
}
