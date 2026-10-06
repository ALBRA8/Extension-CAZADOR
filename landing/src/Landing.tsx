import '@/styles/components.css'
import {
  Navbar,
  Hero,
  Features,
  HowItWorks,
  Comparison,
  Pricing,
  Testimonials,
  CTA,
  Footer,
} from '@/sections'

export function Landing() {
  return (
    <>
      <Navbar />
      <Hero />
      <Features />
      <HowItWorks />
      <Comparison />
      <Pricing />
      <Testimonials />
      <CTA />
      <Footer />
    </>
  )
}
