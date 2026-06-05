import React from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";

export function Breadcrumbs() {
  const location = useLocation();
  const pathnames = location.pathname.split("/").filter((x) => x);

  if (pathnames.length === 0) return null;

  return (
    <nav className="flex items-center space-x-1 text-sm text-stone-500 dark:text-stone-400 my-4" aria-label="Breadcrumb">
      <Link to="/dashboard" className="hover:text-amber-500 transition">Dashboard</Link>
      {pathnames.map((value, index) => {
        const last = index === pathnames.length - 1;
        const to = `/${pathnames.slice(0, index + 1).join("/")}`;

        return (
          <React.Fragment key={to}>
            <ChevronRight className="w-4 h-4" />
            {last ? (
              <span className="font-medium text-stone-800 dark:text-stone-200 capitalize">{value.replace("-", " ")}</span>
            ) : (
              <Link to={to} className="hover:text-amber-500 transition capitalize">{value.replace("-", " ")}</Link>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
