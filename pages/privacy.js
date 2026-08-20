import PublicInfoPage from '../components/PublicInfoPage'

export default function PrivacyPolicy() {
  return <PublicInfoPage title="Privacy Policy" description="Read how HostelSet collects, uses, stores, and protects account, property, tenancy, and application information." path="/privacy-policy">
    <p className="text-sm text-slate-500">Effective 30 June 2026</p>
    <h2 className="text-xl font-semibold text-slate-900">Information we collect</h2>
    <p>Depending on how you use HostelSet, we may process your name, phone number, email address, account information, property and room data, tenant data, uploaded identity documents, photographs, payment proofs, complaints, notices, and rent or payment records.</p>
    <h2 className="text-xl font-semibold text-slate-900">How information is used</h2>
    <p>Information is used to operate accounts and listings, review applications, manage tenancies, record payments, communicate notices, handle complaints and requests, prevent fraud, and maintain service security.</p>
    <h2 className="text-xl font-semibold text-slate-900">Service providers</h2>
    <p>HostelSet uses Supabase for database, authentication, and storage services; Vercel for application hosting; Brevo for service emails; and Geoapify for maps, geocoding, or location features. These providers process limited information needed to deliver their services under their own applicable terms and privacy practices.</p>
    <h2 className="text-xl font-semibold text-slate-900">Storage and access</h2>
    <p>Sensitive documents and payment proofs are kept in secure, access-controlled storage. Access is limited according to account role and business need, such as the applicant, relevant property owner, tenant, or authorised HostelSet administrator.</p>
    <h2 className="text-xl font-semibold text-slate-900">Your choices</h2>
    <p>You may request access or correction of your information, or deletion where legally and operationally permitted, by contacting <a className="font-semibold text-orange-700 underline dark:text-orange-300" href="mailto:support@hostelset.com">support@hostelset.com</a>.</p>
  </PublicInfoPage>
}
