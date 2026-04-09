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
        "h-12 rounded-2xl px-4 font-semibold active:scale-[0.99] disabled:opacity-50",
        "bg-[#6f4e37] text-white shadow-sm",
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
        "h-12 rounded-2xl px-4 font-semibold active:scale-[0.99] disabled:opacity-50",
        "bg-[#c8a27a] text-[#1f1611] shadow-sm",
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
        "h-12 w-full rounded-2xl border border-black/10 bg-white px-4 text-base outline-none",
        "focus:border-black/30",
        className
      )}
      {...props}
    />
  );
}

