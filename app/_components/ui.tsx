"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes } from "react";

function cx(...parts: Array<string | undefined | false | null>) {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cx(
        "h-12 rounded-xl px-4 font-semibold active:scale-[0.99] disabled:opacity-50",
        "bg-zinc-900 text-white",
        className
      )}
      {...props}
    />
  );
}

export function ButtonSecondary({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cx(
        "h-12 rounded-xl px-4 font-semibold active:scale-[0.99] disabled:opacity-50",
        "bg-white text-zinc-950 border border-zinc-200",
        className
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "h-12 w-full rounded-xl border border-zinc-200 bg-white px-4 text-base outline-none",
        "focus:border-zinc-400",
        className
      )}
      {...props}
    />
  );
}

