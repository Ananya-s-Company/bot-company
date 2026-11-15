import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { EnrolForm } from "@/components/EnrolForm";
import { currentSession, getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// 2FA enrolment (AC3a/AC3b). Reachable only with the restricted enrolment session issued
// after a correct password, or a signed-in local session that has not enrolled yet.
// The secret and QR code are generated on this server; nothing is sent elsewhere.
export default async function EnrollPage() {
  const s = await currentSession();
  if (!s) redirect("/login");
  const auth = getAuth();

  let qrDataUri: string | null = null;
  let secret: string | null = null;
  const e = auth.startEnrolment(s);
  if (e) {
    secret = e.secret;
    // QR rendered locally as SVG (qrcode package); no external QR service.
    const svg = await QRCode.toString(e.uri, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
    qrDataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } else if (s.kind !== "full") {
    redirect("/login");
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-semibold">Set up two-factor sign-in</h1>
      <EnrolForm qrDataUri={qrDataUri} secret={secret} />
    </div>
  );
}
