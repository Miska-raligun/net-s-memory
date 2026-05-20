import Link from "next/link";

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-row">
          <span className="footer-brand">net-s-memory</span>
          <span className="footer-sep">·</span>
          <span>互联网记忆</span>
          <span className="footer-sep">·</span>
          <span>Ed25519 + Merkle 日志 + 比特币锚定</span>
        </div>
        <div className="site-footer-row">
          <Link href="/transparency">透明度日志</Link>
          <span className="footer-sep">·</span>
          <Link href="/candidates">候选与排除记录</Link>
          <span className="footer-sep">·</span>
          <Link href="/events">事件聚合</Link>
        </div>
      </div>
    </footer>
  );
}
