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
        "w-full rounded-3xl px-5 py-4 text-[17px] font-semibold leading-none active:scale-[0.99] disabled:opacity-50",
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
        "w-full rounded-3xl px-5 py-4 text-[17px] font-semibold leading-none active:scale-[0.99] disabled:opacity-50",
        "bg-[#c8a27a] text-[#2c2c2c] shadow-sm",
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
        "w-full rounded-3xl border border-black/10 bg-white px-4 py-4 text-[17px] outline-none",
        "placeholder:text-black/40 focus:border-black/30",
        className
      )}
      {...props}
    />
  );
}

