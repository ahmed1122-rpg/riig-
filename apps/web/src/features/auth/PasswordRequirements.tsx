import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  evaluatePasswordRequirements,
} from "@motionprep/contracts";

export function PasswordRequirements({
  password,
  id,
}: {
  password: string;
  id: string;
}) {
  const status = evaluatePasswordRequirements(password);
  const requirements = [
    {
      met: status.length,
      label: `${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} حرفًا`,
    },
    { met: status.lowercaseLatin, label: "حرف لاتيني صغير" },
    { met: status.uppercaseLatin, label: "حرف لاتيني كبير" },
    { met: status.number, label: "رقم واحد" },
  ];

  return (
    <ul id={id} className="password-requirements" aria-live="polite">
      {requirements.map((requirement) => (
        <li key={requirement.label} className={requirement.met ? "is-met" : ""}>
          <span aria-hidden="true">{requirement.met ? "✓" : "○"}</span>
          {requirement.label}
        </li>
      ))}
    </ul>
  );
}
