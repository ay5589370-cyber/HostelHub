import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...values) => twMerge(clsx(values));
export const formatDate = (date = new Date()) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
