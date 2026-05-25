export default function SkeletonFeed({ count = 5 }: { count?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-news">
          <div className="skeleton skeleton-line" style={{ width: "80%" }} />
          <div className="skeleton skeleton-line" style={{ width: "60%" }} />
          <div className="skeleton skeleton-line" style={{ width: "40%", height: 10 }} />
        </div>
      ))}
    </div>
  );
}
