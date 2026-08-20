import PublicInfoPage from '../components/PublicInfoPage'

export default function Contact() {
  return (
    <PublicInfoPage
      title="Contact"
      description="Find the right contact route for a HostelSet property, application, or account question."
      path="/contact"
    >
      <p>For platform and account support, email <a className="font-semibold text-orange-700 underline dark:text-orange-300" href="mailto:support@hostelset.com">support@hostelset.com</a>.</p>
      <p>For general or business enquiries, email <a className="font-semibold text-orange-700 underline dark:text-orange-300" href="mailto:contact@hostelset.com">contact@hostelset.com</a>.</p>
      <p>We aim to respond within 24–48 business hours. Do not include passwords, one-time codes, or unnecessary identity documents in an email.</p>
      <h2 className="text-xl font-semibold text-slate-900">Property-specific questions</h2>
      <p>For questions about a room, rent, availability, payment, refund, or an existing application, contact the relevant property owner using the information displayed on the property listing or in your dashboard.</p>
    </PublicInfoPage>
  )
}
