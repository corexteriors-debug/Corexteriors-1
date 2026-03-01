'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
    Users, MapPin, Phone, Mail, Search, TrendingUp, DollarSign,
    Clock, Plus, Home, Building2, AlertCircle, X, Check
} from 'lucide-react';

type ClientType = 'Residential' | 'Commercial';
type LeadStatus = 'New' | 'Quote Sent' | 'Scheduled' | 'Completed' | 'Invoiced';

interface Lead {
    id: number;
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    source?: string;
    client_type: ClientType;
    status: LeadStatus;
    estimated_labor_hours?: number;
    material_costs?: number;
    gate_codes?: string;
    pet_warnings?: string;
    commercial_instructions?: string;
    created_at: string;
}

export default function CRMDashboard() {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [typeFilter, setTypeFilter] = useState<'All' | ClientType>('All');
    const [showAddModal, setShowAddModal] = useState(false);
    const [loading, setLoading] = useState(true);

    // Fetch leads from API
    useEffect(() => {
        fetchLeads();
    }, []);

    async function fetchLeads() {
        try {
            const res = await fetch('/api/leads');
            if (res.ok) {
                const data = await res.json();
                setLeads(data);
            }
        } catch (e) {
            console.error('Failed to fetch leads:', e);
        } finally {
            setLoading(false);
        }
    }

    const metrics = useMemo(() => {
        const total = leads.length;
        const newLeads = leads.filter(l => l.status === 'New').length;
        const completed = leads.filter(l => l.status === 'Completed' || l.status === 'Invoiced').length;
        const pipeline = leads.reduce((acc, l) => acc + ((l.estimated_labor_hours || 0) * 65) + (l.material_costs || 0), 0);

        return {
            total,
            newLeads,
            pipeline,
            conversionRate: total > 0 ? ((completed / total) * 100).toFixed(1) : '0'
        };
    }, [leads]);

    const filteredLeads = leads.filter(lead => {
        const matchesSearch = lead.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (lead.address || '').toLowerCase().includes(searchTerm.toLowerCase());
        const matchesType = typeFilter === 'All' || lead.client_type === typeFilter;
        return matchesSearch && matchesType;
    });

    async function updateStatus(id: number, newStatus: LeadStatus) {
        setLeads(prev => prev.map(l => l.id === id ? { ...l, status: newStatus } : l));
        // TODO: Call API to update status in DB
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
            {/* Header */}
            <header className="bg-white/80 backdrop-blur-lg border-b border-slate-200 sticky top-0 z-50 shadow-sm">
                <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center text-white font-bold shadow-lg">
                            C
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-slate-900">Core Exteriors CRM</h1>
                            <p className="text-sm text-slate-500">Welcome back, Manager</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-5 py-2.5 rounded-xl font-semibold transition-all shadow-lg shadow-blue-200 hover:shadow-xl"
                    >
                        <Plus className="w-4 h-4" /> Add Lead
                    </button>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-8">
                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <StatCard
                        title="Total Leads"
                        value={metrics.total.toString()}
                        icon={<Users className="w-5 h-5 text-blue-600" />}
                        trend="+12% this month"
                    />
                    <StatCard
                        title="New Leads"
                        value={metrics.newLeads.toString()}
                        icon={<TrendingUp className="w-5 h-5 text-emerald-600" />}
                        trend="Pending action"
                    />
                    <StatCard
                        title="Pipeline Value"
                        value={`$${metrics.pipeline.toLocaleString()}`}
                        icon={<DollarSign className="w-5 h-5 text-amber-600" />}
                        trend="Revenue potential"
                    />
                    <StatCard
                        title="Conversion"
                        value={`${metrics.conversionRate}%`}
                        icon={<Clock className="w-5 h-5 text-purple-600" />}
                        trend="Target: 25%"
                    />
                </div>

                {/* Filters and Search */}
                <div className="bg-white/90 backdrop-blur rounded-2xl border border-slate-200 shadow-lg mb-6 overflow-hidden">
                    <div className="p-5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                        <div className="flex flex-wrap gap-4 items-center justify-between">
                            <div className="flex gap-2">
                                <FilterButton
                                    active={typeFilter === 'All'}
                                    onClick={() => setTypeFilter('All')}
                                    icon={<Users className="w-4 h-4" />}
                                    label="All"
                                />
                                <FilterButton
                                    active={typeFilter === 'Residential'}
                                    onClick={() => setTypeFilter('Residential')}
                                    icon={<Home className="w-4 h-4" />}
                                    label="Residential"
                                />
                                <FilterButton
                                    active={typeFilter === 'Commercial'}
                                    onClick={() => setTypeFilter('Commercial')}
                                    icon={<Building2 className="w-4 h-4" />}
                                    label="Commercial"
                                />
                            </div>
                            <div className="relative flex-1 max-w-md">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Search by name or address..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Leads Table */}
                    <div className="overflow-x-auto">
                        {loading ? (
                            <div className="py-20 text-center text-slate-500">Loading leads...</div>
                        ) : filteredLeads.length === 0 ? (
                            <div className="py-20 text-center">
                                <Users className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                                <p className="text-slate-500 font-medium">No leads found</p>
                                <p className="text-sm text-slate-400 mt-1">Try adjusting your search or filters</p>
                            </div>
                        ) : (
                            <table className="w-full">
                                <thead className="bg-slate-50 border-b border-slate-100">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">Lead</th>
                                        <th className="px-6 py-3 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">Contact</th>
                                        <th className="px-6 py-3 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">Type</th>
                                        <th className="px-6 py-3 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">Status</th>
                                        <th className="px-6 py-3 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">Notes</th>
                                        <th className="px-6 py-3 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredLeads.map((lead) => (
                                        <tr key={lead.id} className="hover:bg-blue-50/50 transition-colors group">
                                            <td className="px-6 py-4">
                                                <div className="font-bold text-slate-900">{lead.name}</div>
                                                {lead.address && (
                                                    <div className="text-sm text-slate-500 flex items-center gap-1 mt-1">
                                                        <MapPin className="w-3 h-3" />
                                                        {lead.address}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="text-sm space-y-1">
                                                    {lead.phone && (
                                                        <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 text-slate-600 hover:text-blue-600">
                                                            <Phone className="w-3 h-3" />
                                                            {lead.phone}
                                                        </a>
                                                    )}
                                                    {lead.email && (
                                                        <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 text-slate-600 hover:text-blue-600">
                                                            <Mail className="w-3 h-3" />
                                                            {lead.email}
                                                        </a>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${lead.client_type === 'Residential'
                                                        ? 'bg-emerald-100 text-emerald-700'
                                                        : 'bg-blue-100 text-blue-700'
                                                    }`}>
                                                    {lead.client_type === 'Residential' ? <Home className="w-3 h-3 mr-1" /> : <Building2 className="w-3 h-3 mr-1" />}
                                                    {lead.client_type}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <select
                                                    value={lead.status}
                                                    onChange={(e) => updateStatus(lead.id, e.target.value as LeadStatus)}
                                                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg border-2 cursor-pointer transition-all ${getStatusStyle(lead.status)}`}
                                                >
                                                    <option value="New">New</option>
                                                    <option value="Quote Sent">Quote Sent</option>
                                                    <option value="Scheduled">Scheduled</option>
                                                    <option value="Completed">Completed</option>
                                                    <option value="Invoiced">Invoiced</option>
                                                </select>
                                            </td>
                                            <td className="px-6 py-4">
                                                {(lead.pet_warnings || lead.gate_codes || lead.commercial_instructions) && (
                                                    <div className="flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-lg border border-amber-200 w-fit">
                                                        <AlertCircle className="w-3 h-3" />
                                                        Key Info
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <a
                                                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.address || lead.name)}`}
                                                    target="_blank"
                                                    className="text-blue-600 hover:text-blue-700 font-medium text-sm"
                                                >
                                                    View Map
                                                </a>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </main>

            {/* Add Lead Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-slate-900">Add New Lead</h3>
                            <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <form className="space-y-4">
                            <input type="text" placeholder="Name" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                            <input type="tel" placeholder="Phone" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                            <input type="email" placeholder="Email" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                            <input type="text" placeholder="Address" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                            <select className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500">
                                <option>Residential</option>
                                <option>Commercial</option>
                            </select>
                            <button type="submit" className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-3 rounded-xl font-semibold hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg">
                                Add Lead
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

function StatCard({ title, value, icon, trend }: { title: string; value: string; icon: React.ReactNode; trend: string }) {
    return (
        <div className="bg-white/90 backdrop-blur rounded-2xl border border-slate-200 p-6 shadow-lg hover:shadow-xl transition-all">
            <div className="flex justify-between items-start mb-3">
                <div className="p-2 bg-slate-50 rounded-xl">{icon}</div>
            </div>
            <div className="text-3xl font-bold text-slate-900 mb-1">{value}</div>
            <div className="text-sm font-medium text-slate-500 mb-1">{title}</div>
            <div className="text-xs text-slate-400 font-semibold">{trend}</div>
        </div>
    );
}

function FilterButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm transition-all ${active
                    ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-200'
                    : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
                }`}
        >
            {icon}
            {label}
        </button>
    );
}

function getStatusStyle(status: LeadStatus) {
    switch (status) {
        case 'New': return 'bg-blue-50 text-blue-700 border-blue-200';
        case 'Quote Sent': return 'bg-amber-50 text-amber-700 border-amber-200';
        case 'Scheduled': return 'bg-purple-50 text-purple-700 border-purple-200';
        case 'Completed': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
        case 'Invoiced': return 'bg-slate-100 text-slate-600 border-slate-200';
        default: return 'bg-slate-50 text-slate-600 border-slate-200';
    }
}
