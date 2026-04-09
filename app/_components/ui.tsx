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
        "w-full rounded-2xl px-5 py-4 text-[17px] font-extrabold leading-none active:scale-[0.99] disabled:opacity-50",
        "bg-black text-white shadow-sm",
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
        "w-full rounded-2xl px-5 py-4 text-[17px] font-extrabold leading-none active:scale-[0.99] disabled:opacity-50",
        "bg-[#f2d2b6] text-black border-2 border-black shadow-sm",
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
        "w-full rounded-2xl border-2 border-black bg-white px-4 py-4 text-[17px] text-black outline-none",
        "placeholder:text-[#1a1a1a] focus:ring-2 focus:ring-black/20",
        className
      )}
      {...props}
    />
  );
}

