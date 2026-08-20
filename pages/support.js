import PublicInfoPage from '../components/PublicInfoPage'

export default function Support() {
  return (
    <PublicInfoPage
      title="HostelSet Support"
      description="Guidance for HostelSet applicants, tenants, and property owners."
      path="/support"
    >
      <h2 className="text-xl font-semibold text-slate-900">How do I apply?</h2>
      <p>Open a public property page, choose an available room, and follow the application steps. Provide truthful information, upload the requested documents, and retain your submitted payment reference and proof.</p>
      <h2 className="text-xl font-semibold text-slate-900">How do I set or reset my password?</h2>
      <p>Use the valid invitation or password-recovery email sent for your account. Open the latest link and complete the password form. If it has expired, request a new link from the login flow.</p>
      <h2 className="text-xl font-semibold text-slate-900">How do rent payments work?</h2>
      <p>Review the owner’s UPI details in your tenant dashboard, pay through your chosen UPI app, then submit the UPI transaction ID and payment screenshot. HostelSet does not directly process the transfer.</p>
      <h2 className="text-xl font-semibold text-slate-900">Why is payment proof pending?</h2>
      <p>The relevant property owner manually verifies the transaction reference and screenshot. Your dashboard updates after the owner approves or rejects the proof.</p>
      <h2 className="text-xl font-semibold text-slate-900">How do I raise a complaint?</h2>
      <p>Use the Complaints section of the tenant dashboard. The owner can respond and update its status there.</p>
      <h2 className="text-xl font-semibold text-slate-900">How do room-change requests work?</h2>
      <p>Select an eligible room through the tenant dashboard and submit a request. Full rooms and duplicate active requests are blocked. Your current assignment remains until approval.</p>
      <h2 className="text-xl font-semibold text-slate-900">How do I request to vacate?</h2>
      <p>A vacate request is available only when required rent obligations are cleared, no payment is awaiting verification, and no active vacate request exists. Approval starts the applicable notice-period workflow.</p>
      <h2 className="text-xl font-semibold text-slate-900">I cannot log in</h2>
      <p>Confirm that you are using the email or phone associated with your account and the latest password. Try password recovery if needed. For further help, contact <a className="font-semibold text-orange-700 underline dark:text-orange-300" href="mailto:support@hostelset.com">support@hostelset.com</a>.</p>
    </PublicInfoPage>
  )
}
