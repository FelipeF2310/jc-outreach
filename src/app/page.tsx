import { AdminApp } from "@/components/admin-app";
import { AdminSignIn } from "@/components/admin-sign-in";
export const dynamic = "force-dynamic";
export default function Home() {
  return process.env.JCO_SYNTHETIC_ONLY === "1" &&
    !process.env.VERCEL &&
    !process.env.DATABASE_URL ? (
    <AdminApp />
  ) : (
    <AdminSignIn />
  );
}
