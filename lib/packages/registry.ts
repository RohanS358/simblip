'use client'

// Subject Component Package Registry.
// Each domain/subject is a component package (Mechanics, Electrical, Electronics,
// Digital, Optics, Waves, Quantum, Economics, DSA).
// Designed for individual monetization and toggleable enable/disable status.

import type { ComponentDef } from '@/lib/scene/factory'

export interface ComponentPackage {
  id: string
  domain: ComponentDef['domain']
  name: string
  subject: string
  description: string
  iconName: string
  price: string // 'Included', 'Free', '$9.99', '$14.99', etc.
  isPurchased: boolean
  featuredComponentIds: string[]
}

export const COMPONENT_PACKAGES: ComponentPackage[] = [
  {
    id: 'package:mechanics',
    domain: 'mechanics',
    name: 'Mechanics & Physics Suite',
    subject: 'Mechanics',
    description: 'Rigid bodies, springs, dampers, hinges, motors, charges, and force fields.',
    iconName: 'Activity',
    price: 'Included',
    isPurchased: true,
    featuredComponentIds: ['mass', 'spring', 'damper', 'hinge', 'motor'],
  },
  {
    id: 'package:electrical',
    domain: 'electrical',
    name: 'Electrical Circuit Lab',
    subject: 'Electrical',
    description: 'Resistors, capacitors, inductors, AC/DC sources, switches, meters, and transformers.',
    iconName: 'Zap',
    price: 'Included',
    isPurchased: true,
    featuredComponentIds: ['resistor', 'capacitor', 'inductor', 'dc-source', 'ammeter'],
  },
  {
    id: 'package:electronics',
    domain: 'electronics',
    name: 'Analog Electronics Suite',
    subject: 'Electronics',
    description: 'Diodes, BJTs (NPN/PNP), MOSFETs, Op-Amps, and active semiconductor devices.',
    iconName: 'Cpu',
    price: 'Included',
    isPurchased: true,
    featuredComponentIds: ['diode', 'bjt-npn', 'mosfet-n', 'opamp'],
  },
  {
    id: 'package:digital',
    domain: 'digital',
    name: 'Digital Logic & Micro-architectures',
    subject: 'Digital',
    description: 'Logic gates (AND, OR, NOT, NAND, NOR, XOR), flip-flops, registers, multiplexers, and 7-segment displays.',
    iconName: 'Binary',
    price: 'Included',
    isPurchased: true,
    featuredComponentIds: ['and-gate', 'or-gate', 'not-gate', 'd-ff', 'seven-seg'],
  },
  {
    id: 'package:optics',
    domain: 'optics',
    name: 'Geometric Optics & Photonics',
    subject: 'Optics',
    description: 'Light sources, thin lenses, optical mirrors, screens, and diffraction slits.',
    iconName: 'Sun',
    price: 'Included',
    isPurchased: true,
    featuredComponentIds: ['light-source', 'thin-lens', 'optical-mirror', 'slit'],
  },
  {
    id: 'package:waves',
    domain: 'waves',
    name: 'Waves & Electromagnetics',
    subject: 'Waves',
    description: 'Plane wave sources, wave boundaries, media interfaces, and transmission lines.',
    iconName: 'Waves',
    price: 'Included',
    isPurchased: true,
    featuredComponentIds: ['wave-source', 'wave-boundary', 'transmission-line'],
  },
  {
    id: 'package:quantum',
    domain: 'quantum',
    name: 'Quantum Mechanics Sandbox',
    subject: 'Quantum',
    description: 'Particle-in-a-box quantum wells, rectangular tunneling barriers, and wavefunctions.',
    iconName: 'Atom',
    price: 'Included',
    isPurchased: true,
    featuredComponentIds: ['quantum-well', 'tunnel-barrier'],
  },
  {
    id: 'package:economics',
    domain: 'economics',
    name: 'Engineering Economics Suite',
    subject: 'Economics',
    description: 'Cashflow timelines, NPV, IRR, MARR payback calculations, and financial diagrams.',
    iconName: 'Coins',
    price: 'Included',
    isPurchased: true,
    featuredComponentIds: ['cashflow'],
  },
  {
    id: 'package:dsa',
    domain: 'dsa',
    name: 'DSA & Algorithms Workbench',
    subject: 'DSA',
    description: 'Interactive C++ IDE, memory layout visualizers, call stack tracers, and complexity analyzers.',
    iconName: 'Terminal',
    price: 'Included',
    isPurchased: true,
    featuredComponentIds: ['dsa'],
  },
]

export function getPackageByDomain(domain: string): ComponentPackage | undefined {
  return COMPONENT_PACKAGES.find((p) => p.domain === domain)
}

export function getPackageById(id: string): ComponentPackage | undefined {
  return COMPONENT_PACKAGES.find((p) => p.id === id || p.domain === id)
}

export function isPackageAccessible(
  packageDomainOrId: string,
  allowedPackages?: string[] | null
): boolean {
  if (!allowedPackages || allowedPackages.length === 0) return true
  const pkg = getPackageById(packageDomainOrId) ?? getPackageByDomain(packageDomainOrId)
  if (!pkg) return true
  return (
    allowedPackages.includes(pkg.id) ||
    allowedPackages.includes(pkg.domain) ||
    allowedPackages.includes(pkg.name)
  )
}
