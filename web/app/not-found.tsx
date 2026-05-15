import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <div className="not-found">
        <div className="not-found-code">404</div>
        <p style={{ fontSize: 16, marginTop: 8 }}>页面不存在</p>
        <p style={{ marginTop: 16 }}>
          <Link href="/">返回首页</Link>
        </p>
      </div>
    </main>
  );
}
