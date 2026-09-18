import { FieldApp } from "@/components/field-app";
import { APP_RELEASE } from "@/lib/app-release";
export default function FieldPage() {
  return (
    <>
      <meta name="jco-app-version" content={APP_RELEASE} />
      <FieldApp />
    </>
  );
}
